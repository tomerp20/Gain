import fs from 'fs';
import path from 'path';
import type { Email, EmailStore, ReplyRecord, Thread } from '../types/index.js';

interface StorageShape {
  emails: Record<string, Email>;
  replies: Record<string, { replyEmailId: string; sentAt: string }>;
}

function emptyStore(): StorageShape {
  return { emails: {}, replies: {} };
}

function atomicWrite(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export class JsonEmailStore implements EmailStore {
  private readonly emailsPath: string;
  private readonly threadsPath: string;
  private state: StorageShape;

  constructor(storagePath: string) {
    this.emailsPath = path.join(storagePath, 'emails.json');
    this.threadsPath = path.join(storagePath, 'threads.json');
    fs.mkdirSync(storagePath, { recursive: true });
    this.state = this.load();
  }

  private load(): StorageShape {
    if (!fs.existsSync(this.emailsPath)) return emptyStore();
    try {
      return JSON.parse(fs.readFileSync(this.emailsPath, 'utf8')) as StorageShape;
    } catch {
      return emptyStore();
    }
  }

  private flush(): void {
    atomicWrite(this.emailsPath, this.state);
  }

  async upsert(email: Email): Promise<void> {
    this.state.emails[email.id] = email;
    this.flush();
  }

  async getAll(): Promise<Email[]> {
    return Object.values(this.state.emails);
  }

  async getById(id: string): Promise<Email | undefined> {
    return this.state.emails[id];
  }

  async markReadLocally(id: string, value: boolean): Promise<void> {
    const email = this.state.emails[id];
    if (!email) return;
    this.state.emails[id] = { ...email, is_read: value };
    this.flush();
  }

  async saveThreadsSnapshot(threads: Thread[]): Promise<void> {
    atomicWrite(this.threadsPath, threads);
  }

  async recordReply(threadId: string, replyEmailId: string, sentAt: Date): Promise<void> {
    this.state.replies[threadId] = { replyEmailId, sentAt: sentAt.toISOString() };
    this.flush();
  }

  async getReplyRecord(threadId: string): Promise<ReplyRecord | undefined> {
    const r = this.state.replies[threadId];
    if (!r) return undefined;
    return { replyEmailId: r.replyEmailId, sentAt: new Date(r.sentAt) };
  }

  async hasRepliedTo(threadId: string): Promise<boolean> {
    return threadId in this.state.replies;
  }
}
