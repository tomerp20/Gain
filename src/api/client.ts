import { z } from 'zod';
import type { ApiClient as IApiClient, Config, Email, Logger, SendEmailPayload } from '../types/index.js';
import { EmailSchema } from '../types/index.js';

export class ApiError extends Error {
  constructor(
    public readonly type: 'network' | 'timeout' | 'http' | 'validation',
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BACKOFF_MS = [250, 750, 2250] as const;
const TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jitteredDelay(baseMs: number): number {
  return baseMs * (1 + Math.random() * 0.3);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  logger: Logger
): Promise<T> {
  if (retries > BACKOFF_MS.length) {
    throw new Error(`withRetry: retries=${retries} exceeds BACKOFF_MS table length (${BACKOFF_MS.length})`);
  }
  let lastError: unknown;
  const maxAttempts = retries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.type === 'validation') throw err;
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = jitteredDelay(BACKOFF_MS[attempt]!);
        logger.warn(
          { attemptNumber: attempt + 1, maxAttempts, retryDelayMs: Math.round(delay) },
          'API request failed, retrying'
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export class FetchApiClient implements IApiClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(config: Config, logger: Logger) {
    this.baseUrl = config.GAIN_API_BASE_URL.replace(/\/$/, '');
    this.logger = logger;
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodSchema<T>,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      throw new ApiError(
        isTimeout ? 'timeout' : 'network',
        isTimeout
          ? `Request timed out after ${TIMEOUT_MS}ms: ${method} ${path}`
          : `Network error: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ApiError('http', `HTTP ${response.status} from ${method} ${path}: ${text.slice(0, 200)}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new ApiError(
        'validation',
        `Failed to parse JSON from ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        'validation',
        `API contract mismatch at ${method} ${path}: ${parsed.error.message}`
      );
    }
    return parsed.data;
  }

  async listEmails(start: number, end: number): Promise<Email[]> {
    return withRetry(
      () => this.request('GET', `/emails?start=${start}&end=${end}`, z.array(EmailSchema)),
      3,
      this.logger
    );
  }

  async getEmail(emailId: string): Promise<Email> {
    return withRetry(
      () => this.request('GET', `/emails/${emailId}`, EmailSchema),
      3,
      this.logger
    );
  }

  async sendEmail(payload: SendEmailPayload): Promise<Email> {
    return this.request('POST', '/emails/send', EmailSchema, payload);
  }

  async markRead(emailId: string, isRead: boolean): Promise<void> {
    await withRetry(
      () => this.request('PUT', `/emails/${emailId}/read`, EmailSchema, { is_read: isRead }),
      2,
      this.logger
    );
  }

  async health(): Promise<{ status: string }> {
    return withRetry(
      () => this.request('GET', '/health', z.object({ status: z.string() })),
      2,
      this.logger
    );
  }
}
