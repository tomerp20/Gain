import type { ApiClient, EmailStore, LlmClient, Thread, ReplySummary, ThreadReplyResult, Logger } from './types/index.js';
import { buildThreadPrompt } from './llm-client.js';

export async function replyToActionableThreads(
  threads: Thread[],
  client: ApiClient,
  store: EmailStore,
  llm: LlmClient,
  fromAddress: string,
  logger: Logger,
): Promise<ReplySummary> {
  const log = logger.child({ module: 'reply-engine' });
  const results: ThreadReplyResult[] = [];

  for (const thread of threads) {
    const log2 = log.child({ threadId: thread.thread_id });

    if (await store.hasRepliedTo(thread.thread_id)) {
      log2.info('skipping — already replied');
      results.push({ threadId: thread.thread_id, status: 'skipped_already_replied' });
      continue;
    }

    if (thread.latest.email_direction !== 'in' || thread.latest.is_read) {
      results.push({ threadId: thread.thread_id, status: 'skipped_not_actionable' });
      continue;
    }

    try {
      const promptMessages = thread.messages.map((m) => ({
        from: m.from_address,
        body: m.body,
        date: m.created_at,
      }));
      const { system, user } = buildThreadPrompt(thread.latest.subject, promptMessages);

      log2.info({ messageCount: thread.messages.length }, 'generating LLM reply');
      const body = await llm.generate(system, user);

      const sent = await client.sendEmail({
        subject: `Re: ${thread.latest.subject}`,
        from_address: fromAddress,
        to_addresses: [thread.latest.from_address],
        body,
        in_reply_to: thread.latest.id,
      });

      await client.markRead(thread.latest.id, true);
      await store.markReadLocally(thread.latest.id, true);
      await store.recordReply(thread.thread_id, sent.id, new Date());

      log2.info({ replyId: sent.id }, 'reply sent and recorded');
      results.push({ threadId: thread.thread_id, status: 'sent', replyId: sent.id });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log2.error({ error }, 'failed to reply');
      results.push({ threadId: thread.thread_id, status: 'error', error });
    }
  }

  const summary: ReplySummary = {
    replied: results.filter((r) => r.status === 'sent').length,
    skippedAlreadyReplied: results.filter((r) => r.status === 'skipped_already_replied').length,
    skippedNotActionable: results.filter((r) => r.status === 'skipped_not_actionable').length,
    skippedSpam: results.filter((r) => r.status === 'skipped_spam').length,
    errors: results.filter((r) => r.status === 'error'),
  };

  return summary;
}
