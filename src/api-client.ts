import { EmailSchema, type Email, type ApiClient, type SendEmailPayload, type Logger } from './types/index.js';
import { z } from 'zod';

const PAGE_SIZE = 50;

export function createApiClient(baseUrl: string, logger: Logger): ApiClient {
  const log = logger.child({ module: 'api-client' });

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${url} → ${res.status}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    async listEmails(start: number, end: number): Promise<Email[]> {
      const raw = await request<unknown[]>('GET', `/emails?start=${start}&end=${end}`);
      return z.array(EmailSchema).parse(raw);
    },

    async getEmail(emailId: string): Promise<Email> {
      const raw = await request<unknown>('GET', `/emails/${emailId}`);
      return EmailSchema.parse(raw);
    },

    async sendEmail(payload: SendEmailPayload): Promise<Email> {
      log.debug({ payload }, 'sending email');
      const raw = await request<unknown>('POST', '/emails/send', payload);
      return EmailSchema.parse(raw);
    },

    async markRead(emailId: string, isRead: boolean): Promise<void> {
      await request<void>('PUT', `/emails/${emailId}/read`, { is_read: isRead });
    },
  };
}

export async function fetchAllEmails(client: ApiClient, logger: Logger): Promise<Email[]> {
  const log = logger.child({ module: 'fetch-all' });
  const all: Email[] = [];
  let start = 0;

  while (true) {
    const batch = await client.listEmails(start, start + PAGE_SIZE);
    log.debug({ start, count: batch.length }, 'fetched page');
    if (batch.length === 0) break;
    all.push(...batch);
    start += PAGE_SIZE;
    if (batch.length < PAGE_SIZE) break;
  }

  log.info({ total: all.length }, 'finished fetching emails');
  return all;
}
