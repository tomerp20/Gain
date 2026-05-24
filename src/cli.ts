import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createApiClient, fetchAllEmails } from './api-client.js';
import { createStore } from './store.js';
import { build as buildThreads } from './threads/index.js';
import { createLlmClient } from './llm-client.js';
import { replyToActionableThreads } from './reply-engine.js';
import type { Thread } from './types/index.js';

const command = process.argv[2] ?? 'run';
const config = loadConfig();
const logger = createLogger(config);
const api = createApiClient(config.GAIN_API_BASE_URL, logger);
const store = createStore(config.GAIN_STORAGE_PATH);
const llm = createLlmClient(config);

function filterActionable(threads: Thread[]): Thread[] {
  return threads.filter(
    (t) => t.latest.email_direction === 'in' && !t.latest.is_read,
  );
}

async function cmdIngest(): Promise<void> {
  logger.info('ingesting emails from API…');
  const emails = await fetchAllEmails(api, logger);
  for (const email of emails) {
    await store.upsert(email);
  }
  logger.info({ count: emails.length }, 'ingest complete');
}

async function cmdThreads(): Promise<void> {
  const emails = await store.getAll();
  logger.info({ emailCount: emails.length }, 'building threads…');
  const threads = buildThreads(emails, logger);
  await store.saveThreadsSnapshot(threads);
  logger.info({ threadCount: threads.length }, 'threads persisted');
}

async function cmdActionable(): Promise<void> {
  const emails = await store.getAll();
  const threads = buildThreads(emails, logger);
  const actionable = filterActionable(threads);
  logger.info({ actionableCount: actionable.length, totalThreads: threads.length }, 'actionable threads');
  for (const t of actionable) {
    logger.info({
      threadId: t.thread_id,
      subject: t.latest.subject,
      from: t.latest.from_address,
      messageCount: t.messages.length,
    }, 'actionable thread');
  }
}

async function cmdReply(): Promise<void> {
  const emails = await store.getAll();
  const threads = buildThreads(emails, logger);
  const actionable = filterActionable(threads);
  logger.info({ actionableCount: actionable.length }, 'replying to actionable threads…');

  const summary = await replyToActionableThreads(
    actionable,
    api,
    store,
    llm,
    config.GAIN_FROM_ADDRESS,
    logger,
  );

  logger.info({
    replied: summary.replied,
    skippedAlreadyReplied: summary.skippedAlreadyReplied,
    skippedNotActionable: summary.skippedNotActionable,
    skippedSpam: summary.skippedSpam,
    errors: summary.errors.length,
  }, 'reply run complete');

  if (summary.errors.length > 0) {
    for (const e of summary.errors) {
      logger.error({ threadId: e.threadId, error: e.error }, 'reply error');
    }
    process.exitCode = 1;
  }
}

async function cmdRun(): Promise<void> {
  await cmdIngest();
  await cmdThreads();
  await cmdReply();
}

const commands: Record<string, () => Promise<void>> = {
  ingest: cmdIngest,
  threads: cmdThreads,
  actionable: cmdActionable,
  reply: cmdReply,
  run: cmdRun,
};

const fn = commands[command];
if (!fn) {
  logger.error({ command }, 'unknown command — valid: ingest | threads | actionable | reply | run');
  process.exit(1);
}

fn().catch((err) => {
  logger.error({ err }, 'fatal error');
  process.exit(1);
});
