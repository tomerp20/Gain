import { build } from './threads/index.js';
import { FetchApiClient } from './api/client.js';
import { JsonEmailStore } from './storage/JsonEmailStore.js';
import { AzureOpenAiLlmClient } from './llm/index.js';
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

export class GainMailbox {
  private readonly logger: Logger;
  private readonly api: FetchApiClient;
  private readonly store: JsonEmailStore;
  private readonly replyService: ReplyService;

  constructor(config: Config) {
    this.logger = createLogger(config);
    this.api = new FetchApiClient(config, this.logger);
    this.store = new JsonEmailStore(config.GAIN_STORAGE_PATH);
    const llm = new AzureOpenAiLlmClient(config, this.logger);
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
      result.push(thread);
    }
    return result;
  }
}
