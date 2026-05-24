import type {
  ApiClient,
  LlmClient,
  EmailStore,
  Logger,
  Thread,
  ReplySummary,
} from '../types/index.js';

const SYSTEM_PROMPT = `You are a professional email assistant. You will receive an email thread and must write a reply to the most recent message. Be concise, helpful, and address the specific content of the conversation. Write only the reply body — no subject line, no headers, no salutation unless appropriate.`;

function buildUserPrompt(thread: Thread): string {
  const renderedMessages = thread.messages.map(msg => {
    const date = new Date(msg.created_at).toISOString();
    const to = msg.to_addresses.join(', ');
    return [
      `---`,
      `Date: ${date}`,
      `From: ${msg.from_address}`,
      `To: ${to}`,
      `Subject: ${msg.subject}`,
      ``,
      msg.body,
    ].join('\n');
  });

  return `Please write a reply to the following email thread (shown oldest to newest):\n\n${renderedMessages.join('\n\n')}\n\nWrite only the reply body.`;
}

function replySubject(original: string): string {
  return original.startsWith('Re: ') ? original : `Re: ${original}`;
}

export class ReplyService {
  constructor(
    private readonly api: ApiClient,
    private readonly llm: LlmClient,
    private readonly store: EmailStore,
    private readonly logger: Logger,
    private readonly fromAddress: string
  ) {}

  private async isActionable(thread: Thread): Promise<boolean> {
    if (thread.latest.email_direction !== 'in') return false;
    if (thread.latest.is_read) return false;
    if (await this.store.hasRepliedTo(thread.thread_id)) return false;
    return true;
  }

  async replyToActionable(threads: Thread[]): Promise<ReplySummary> {
    const summary: ReplySummary = {
      replied: 0,
      skippedAlreadyReplied: 0,
      skippedNotActionable: 0,
      skippedSpam: 0,
      errors: [],
    };

    for (const thread of threads) {
      const threadLogger = this.logger.child({ threadId: thread.thread_id });

      if (await this.store.hasRepliedTo(thread.thread_id)) {
        summary.skippedAlreadyReplied++;
        continue;
      }

      if (thread.latest.email_direction !== 'in' || thread.latest.is_read) {
        summary.skippedNotActionable++;
        continue;
      }

      try {
        let replyBody: string;
        try {
          replyBody = await this.llm.generate(SYSTEM_PROMPT, buildUserPrompt(thread));
        } catch (err) {
          threadLogger.error({ err }, 'LLM generation failed');
          summary.errors.push({
            threadId: thread.thread_id,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        const sent = await this.api.sendEmail({
          subject: replySubject(thread.latest.subject),
          from_address: this.fromAddress,
          to_addresses: [thread.latest.from_address],
          body: replyBody,
          in_reply_to: thread.latest.id,
        });

        // Durable idempotency gate — must precede mark-read
        await this.store.recordReply(thread.thread_id, sent.id, new Date());

        try {
          await this.api.markRead(thread.latest.id, true);
        } catch (err) {
          threadLogger.warn({ err }, 'markRead failed after successful reply');
        }

        summary.replied++;
        threadLogger.info({ replyId: sent.id }, 'Reply sent');
      } catch (err) {
        threadLogger.error({ err }, 'Failed to process thread');
        summary.errors.push({
          threadId: thread.thread_id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return summary;
  }
}
