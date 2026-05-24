import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Email, Thread, EmailStore, ReplyRecord } from './types/index.js';

interface StoreData {
  emails: Email[];
  threads: Thread[];
  replies: Record<string, { replyEmailId: string; sentAt: string }>;
}

function emptyStore(): StoreData {
  return { emails: [], threads: [], replies: {} };
}

export function createStore(storagePath: string): EmailStore {
  async function load(): Promise<StoreData> {
    let raw: string;
    try {
      raw = await readFile(storagePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
      throw err;
    }
    // Parse errors must throw — silently returning empty would wipe reply records
    return JSON.parse(raw) as StoreData;
  }

  async function save(data: StoreData): Promise<void> {
    await mkdir(dirname(storagePath), { recursive: true });
    const tmp = `${storagePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, storagePath);
  }

  return {
    async upsert(email: Email): Promise<void> {
      const data = await load();
      const idx = data.emails.findIndex((e) => e.id === email.id);
      if (idx >= 0) {
        data.emails[idx] = email;
      } else {
        data.emails.push(email);
      }
      await save(data);
    },

    async upsertMany(emails: Email[]): Promise<void> {
      const data = await load();
      const byId = new Map(data.emails.map((e) => [e.id, e]));
      for (const email of emails) {
        byId.set(email.id, email);
      }
      data.emails = [...byId.values()];
      await save(data);
    },

    async getAll(): Promise<Email[]> {
      const data = await load();
      return data.emails;
    },

    async getById(id: string): Promise<Email | undefined> {
      const data = await load();
      return data.emails.find((e) => e.id === id);
    },

    async markReadLocally(id: string, value: boolean): Promise<void> {
      const data = await load();
      const email = data.emails.find((e) => e.id === id);
      if (email) {
        email.is_read = value;
        await save(data);
      }
    },

    async saveThreadsSnapshot(threads: Thread[]): Promise<void> {
      const data = await load();
      data.threads = threads;
      await save(data);
    },

    async recordReply(threadId: string, replyEmailId: string, sentAt: Date): Promise<void> {
      const data = await load();
      data.replies[threadId] = { replyEmailId, sentAt: sentAt.toISOString() };
      await save(data);
    },

    async getReplyRecord(threadId: string): Promise<ReplyRecord | undefined> {
      const data = await load();
      const rec = data.replies[threadId];
      if (!rec) return undefined;
      return { replyEmailId: rec.replyEmailId, sentAt: new Date(rec.sentAt) };
    },

    async hasRepliedTo(threadId: string): Promise<boolean> {
      const data = await load();
      return threadId in data.replies;
    },
  };
}
