import { z } from 'zod';

export const EmailSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  from_address: z.string(),
  to_addresses: z.array(z.string()),
  body: z.string(),
  is_read: z.boolean(),
  is_sent: z.boolean(),
  email_direction: z.enum(['in', 'out']),
  in_reply_to: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
});

export type Email = z.infer<typeof EmailSchema>;

export interface Thread {
  thread_id: string;
  messages: Email[];
  latest: Email;
}

export interface ThreadReplyResult {
  threadId: string;
  status:
    | 'sent'
    | 'skipped_already_replied'
    | 'skipped_not_actionable'
    | 'skipped_spam'
    | 'error';
  replyId?: string;
  error?: string;
}

export interface ReplySummary {
  replied: number;
  skippedAlreadyReplied: number;
  skippedNotActionable: number;
  skippedSpam: number;
  errors: ThreadReplyResult[];
}

export const ConfigSchema = z.object({
  GAIN_API_BASE_URL: z.string().url(),
  GAIN_FROM_ADDRESS: z.string().email(),
  GAIN_STORAGE_PATH: z.string().min(1),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_API_KEY: z.string().min(1),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1),
  AZURE_OPENAI_API_VERSION: z.string().default('2025-01-01-preview'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export interface Logger {
  trace(obj: Record<string, unknown> | string, msg?: string): void;
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
  child(bindings: Record<string, string>): Logger;
}

export interface SendEmailPayload {
  subject: string;
  from_address: string;
  to_addresses: string[];
  body: string;
  in_reply_to: string;
}

export interface ApiClient {
  listEmails(start: number, end: number): Promise<Email[]>;
  getEmail(emailId: string): Promise<Email>;
  sendEmail(payload: SendEmailPayload): Promise<Email>;
  markRead(emailId: string, isRead: boolean): Promise<void>;
  health(): Promise<{ status: string }>;
}

export interface ReplyRecord {
  replyEmailId: string;
  sentAt: Date;
}

export interface EmailStore {
  upsert(email: Email): Promise<void>;
  getAll(): Promise<Email[]>;
  getById(id: string): Promise<Email | undefined>;
  markReadLocally(id: string, value: boolean): Promise<void>;
  saveThreadsSnapshot(threads: Thread[]): Promise<void>;
  recordReply(threadId: string, replyEmailId: string, sentAt: Date): Promise<void>;
  getReplyRecord(threadId: string): Promise<ReplyRecord | undefined>;
  hasRepliedTo(threadId: string): Promise<boolean>;
}

export interface LlmClient {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
}
