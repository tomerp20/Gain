import { build } from './threads/index.js';
import { FetchApiClient } from './api/client.js';
import { JsonEmailStore } from './storage/JsonEmailStore.js';
import { AzureOpenAiLlmClient } from './llm/index.js';
import { LlmSpamClassifier } from './spam/index.js';
import { ReplyService } from './reply/service.js';
import { createLogger } from './logger.js';
import type { Config, Thread, ReplySummary, Logger } from './types/index.js';

export interface IngestResult {
  fetched: number;
  durationMs: number;
}

export interface BuildThreadsResult {
  built: number;
  actionable: number;
}

export interface ClassifySpamResult {
  classified: number;
  spam: number;
  ham: number;
  preFiltered: number;
  durationMs: number;
}

async function mapBounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class GainMailbox {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly api: FetchApiClient;
  private readonly store: JsonEmailStore;
  private readonly replyService: ReplyService;
  private readonly classifier: LlmSpamClassifier;

  constructor(config: Config) {
    this.config = config;
    this.logger = createLogger(config);
    this.api = new FetchApiClient(config, this.logger);
    this.store = new JsonEmailStore(config.GAIN_STORAGE_PATH);
    const llm = new AzureOpenAiLlmClient(config, this.logger);
    this.classifier = new LlmSpamClassifier(llm, this.logger);
    this.replyService = new ReplyService(
      this.api,
      llm,
      this.store,
      this.logger,
      config.GAIN_FROM_ADDRESS,
    );
  }

  async ingest(): Promise<IngestResult> {
    const startMs = Date.now();
    const PAGE_SIZE = 500;
    let fetched = 0;
    let pageStart = 0;

    this.logger.info({ phase: 'ingest', status: 'start' }, 'Starting email ingestion');

    while (true) {
      const page = await this.api.listEmails(pageStart, pageStart + PAGE_SIZE);
      if (page.length === 0) break;

      await this.store.upsertBatch(page);
      fetched += page.length;
      pageStart += PAGE_SIZE;
      this.logger.debug({ phase: 'ingest', fetched, pageStart }, 'Page ingested');
    }

    const durationMs = Date.now() - startMs;
    this.logger.info({ phase: 'ingest', status: 'done', fetched, durationMs }, 'Email ingestion complete');

    return { fetched, durationMs };
  }

  async classifySpam(): Promise<ClassifySpamResult> {
    if (!this.config.SPAM_CLASSIFIER_ENABLED) {
      this.logger.info({ phase: 'spam', status: 'disabled' }, 'Spam classifier disabled, skipping');
      return { classified: 0, spam: 0, ham: 0, preFiltered: 0, durationMs: 0 };
    }

    const startMs = Date.now();
    this.logger.info({ phase: 'spam', status: 'start' }, 'Starting spam classification');

    const unclassified = await this.store.getUnclassified();

    // Pre-filter: replies to our own outgoing emails are always ham — free, no LLM call
    const toProcess = [];
    let preFiltered = 0;
    for (const email of unclassified) {
      if (email.in_reply_to) {
        const parent = await this.store.getById(email.in_reply_to);
        if (parent && parent.email_direction === 'out') {
          await this.store.updateSpamLabel(email.id, 'ham', 1.0);
          preFiltered++;
          continue;
        }
      }
      toProcess.push(email);
    }

    // LLM pass with bounded concurrency
    let spam = 0;
    let ham = 0;
    await mapBounded(toProcess, 8, async email => {
      const result = await this.classifier.classify(email);
      if (result.label !== null && result.confidence !== null) {
        await this.store.updateSpamLabel(email.id, result.label, result.confidence);
        if (result.label === 'spam') spam++;
        else ham++;
      } else {
        this.logger.debug({ emailId: email.id }, 'Spam classification returned null, will retry next run');
      }
    });

    const durationMs = Date.now() - startMs;
    const classified = spam + ham + preFiltered;
    this.logger.info(
      { phase: 'spam', status: 'done', classified, spam, ham, preFiltered, durationMs },
      'Spam classification complete',
    );

    return { classified, spam, ham, preFiltered, durationMs };
  }

  async buildThreads(): Promise<BuildThreadsResult> {
    this.logger.info({ phase: 'buildThreads', status: 'start' }, 'Building threads');

    const emails = await this.store.getAll();
    const threads = build(emails, this.logger);
    await this.store.saveThreadsSnapshot(threads);

    const actionable = await this._filterActionable(threads);

    this.logger.info(
      { phase: 'buildThreads', status: 'done', built: threads.length, actionable: actionable.length },
      'Threads built',
    );

    return { built: threads.length, actionable: actionable.length };
  }

  async getActionableThreads(): Promise<Thread[]> {
    const emails = await this.store.getAll();
    const threads = build(emails, this.logger);
    return this._filterActionable(threads);
  }

  async replyToActionable(): Promise<ReplySummary> {
    this.logger.info({ phase: 'reply', status: 'start' }, 'Starting reply phase');

    const actionable = await this.getActionableThreads();
    this.logger.info({ phase: 'reply', actionable: actionable.length }, 'Actionable threads identified');

    const summary = await this.replyService.replyToActionable(actionable);
    const { replied, skippedAlreadyReplied, skippedNotActionable, skippedSpam } = summary;
    this.logger.info(
      { phase: 'reply', status: 'done', replied, skippedAlreadyReplied, skippedNotActionable, skippedSpam, errors: summary.errors.length },
      'Reply phase complete',
    );

    return summary;
  }

  private async _filterActionable(threads: Thread[]): Promise<Thread[]> {
    const result: Thread[] = [];
    for (const thread of threads) {
      const { latest } = thread;
      if (latest.email_direction !== 'in' || latest.is_read) continue;
      if (await this.store.hasRepliedTo(thread.thread_id)) continue;
      if (
        this.config.SPAM_CLASSIFIER_ENABLED &&
        latest.spam_label === 'spam' &&
        (latest.spam_confidence ?? 0) >= this.config.SPAM_CONFIDENCE_THRESHOLD
      ) continue;
      result.push(thread);
    }
    return result;
  }
}
