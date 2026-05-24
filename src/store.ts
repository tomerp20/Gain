import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
    try {
      const raw = await readFile(storagePath, 'utf-8');
      return JSON.parse(raw) as StoreData;
    } catch {
      return emptyStore();
    }
  }

  async function save(data: StoreData): Promise<void> {
    await mkdir(dirname(storagePath), { recursive: true });
    const tmp = `${storagePath}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    // Atomic rename — Node fs/promises rename is atomic on same-filesystem
    const { rename } = await import('node:fs/promises');
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
