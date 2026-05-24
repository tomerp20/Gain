import type { Email, Thread, Logger } from '../types/index.js';

export function build(emails: Email[], logger: Logger): Thread[] {
  if (emails.length === 0) return [];

  const byId = new Map<string, Email>();
  for (const email of emails) {
    byId.set(email.id, email);
  }

  const childrenMap = new Map<string, string[]>();
  for (const email of emails) {
    if (!childrenMap.has(email.id)) {
      childrenMap.set(email.id, []);
    }
    if (email.in_reply_to !== null) {
      const parentId = email.in_reply_to;
      if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, []);
      }
      childrenMap.get(parentId)!.push(email.id);
    }
  }

  const roots: Email[] = [];
  for (const email of emails) {
    if (email.in_reply_to === null || !byId.has(email.in_reply_to)) {
      if (email.in_reply_to !== null) {
        logger.warn(
          { emailId: email.id, missingParent: email.in_reply_to },
          'Orphan email: parent not found, treating as root',
        );
      }
      roots.push(email);
    }
  }

  const globalVisited = new Set<string>();
  const threads: Thread[] = [];

  for (const root of roots) {
    const messages: Email[] = [];

    const dfs = (id: string): void => {
      if (globalVisited.has(id)) {
        throw new Error(`Cycle or shared-parent detected at email id: ${id}`);
      }
      globalVisited.add(id);
      const email = byId.get(id);
      if (email) messages.push(email);
      for (const childId of childrenMap.get(id) ?? []) {
        dfs(childId);
      }
    };

    dfs(root.id);

    messages.sort((a, b) => {
      const timeDiff = a.created_at.localeCompare(b.created_at);
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id);
    });

    threads.push({
      thread_id: root.id,
      messages,
      latest: messages[messages.length - 1],
    });
  }

  // Detect isolated cycles: nodes unreachable from any root must form cycles
  if (globalVisited.size !== byId.size) {
    const unvisited = [...byId.keys()].filter(id => !globalVisited.has(id));
    throw new Error(`Cycle detected: emails not reachable from any root: ${unvisited.join(', ')}`);
  }

  threads.sort((a, b) => {
    const timeDiff = b.latest.created_at.localeCompare(a.latest.created_at);
    return timeDiff !== 0 ? timeDiff : b.latest.id.localeCompare(a.latest.id);
  });

  return threads;
}
