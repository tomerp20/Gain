import { describe, it, expect, vi } from 'vitest';
import { build } from './index.js';
import type { Email, Logger } from '../types/index.js';

const ID1 = '00000000-0000-0000-0000-000000000001';
const ID2 = '00000000-0000-0000-0000-000000000002';
const ID3 = '00000000-0000-0000-0000-000000000003';
const ID4 = '00000000-0000-0000-0000-000000000004';

function makeEmail(overrides: Partial<Email> & { id: string }): Email {
  return {
    id: overrides.id,
    subject: overrides.subject ?? 'Test Subject',
    from_address: overrides.from_address ?? 'sender@example.com',
    to_addresses: overrides.to_addresses ?? ['recipient@example.com'],
    body: overrides.body ?? 'Test body',
    is_read: overrides.is_read ?? false,
    is_sent: overrides.is_sent ?? false,
    email_direction: overrides.email_direction ?? 'in',
    in_reply_to: overrides.in_reply_to ?? null,
    created_at: overrides.created_at ?? '2024-01-01T00:00:00.000Z',
  };
}

function makeLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('ThreadBuilder.build', () => {
  it('1. empty input returns []', () => {
    expect(build([], makeLogger())).toEqual([]);
  });

  it('2. single email with no parent becomes one thread with one message', () => {
    const email = makeEmail({ id: ID1 });
    const threads = build([email], makeLogger());
    expect(threads).toHaveLength(1);
    expect(threads[0].thread_id).toBe(ID1);
    expect(threads[0].messages).toEqual([email]);
    expect(threads[0].latest).toEqual(email);
  });

  it('3. linear chain A→B→C becomes one thread with messages [A, B, C]', () => {
    const a = makeEmail({ id: ID1, created_at: '2024-01-01T01:00:00.000Z' });
    const b = makeEmail({ id: ID2, in_reply_to: ID1, created_at: '2024-01-01T02:00:00.000Z' });
    const c = makeEmail({ id: ID3, in_reply_to: ID2, created_at: '2024-01-01T03:00:00.000Z' });
    const threads = build([c, b, a], makeLogger());
    expect(threads).toHaveLength(1);
    expect(threads[0].thread_id).toBe(ID1);
    expect(threads[0].messages).toEqual([a, b, c]);
    expect(threads[0].latest).toEqual(c);
  });

  it('4. branching A→B, A→C collapses to flat list sorted by (created_at, id)', () => {
    const a = makeEmail({ id: ID1, created_at: '2024-01-01T01:00:00.000Z' });
    const b = makeEmail({ id: ID2, in_reply_to: ID1, created_at: '2024-01-01T02:00:00.000Z' });
    const c = makeEmail({ id: ID3, in_reply_to: ID1, created_at: '2024-01-01T03:00:00.000Z' });
    const threads = build([b, c, a], makeLogger());
    expect(threads).toHaveLength(1);
    expect(threads[0].messages).toEqual([a, b, c]);
    expect(threads[0].latest).toEqual(c);
  });

  it('5. two independent threads become two threads with no cross-contamination', () => {
    const a = makeEmail({ id: ID1, created_at: '2024-01-01T01:00:00.000Z' });
    const b = makeEmail({ id: ID2, in_reply_to: ID1, created_at: '2024-01-01T02:00:00.000Z' });
    const c = makeEmail({ id: ID3, created_at: '2024-01-01T03:00:00.000Z' });
    const d = makeEmail({ id: ID4, in_reply_to: ID3, created_at: '2024-01-01T04:00:00.000Z' });
    const threads = build([a, b, c, d], makeLogger());
    expect(threads).toHaveLength(2);
    // thread C-D has latest at 04:00, thread A-B has latest at 02:00
    expect(threads[0].thread_id).toBe(ID3);
    expect(threads[0].messages).toEqual([c, d]);
    expect(threads[1].thread_id).toBe(ID1);
    expect(threads[1].messages).toEqual([a, b]);
  });

  it('6. orphan email becomes its own thread and logs a warning', () => {
    const logger = makeLogger();
    const orphan = makeEmail({ id: ID2, in_reply_to: ID1 }); // ID1 not in dataset
    const threads = build([orphan], logger);
    expect(threads).toHaveLength(1);
    expect(threads[0].thread_id).toBe(ID2);
    expect(threads[0].messages).toEqual([orphan]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: ID2, missingParent: ID1 }),
      expect.any(String),
    );
  });

  it('7. tiebreak on identical created_at is deterministic by id (ascending)', () => {
    const ts = '2024-01-01T00:00:00.000Z';
    const a = makeEmail({ id: ID1, created_at: ts });
    const b = makeEmail({ id: ID2, in_reply_to: ID1, created_at: ts });
    const c = makeEmail({ id: ID3, in_reply_to: ID1, created_at: ts });
    const threads = build([c, b, a], makeLogger());
    expect(threads).toHaveLength(1);
    expect(threads[0].messages.map(m => m.id)).toEqual([ID1, ID2, ID3]);
  });

  it('8. cyclic input (A→B, B→A) throws', () => {
    const a = makeEmail({ id: ID1, in_reply_to: ID2 });
    const b = makeEmail({ id: ID2, in_reply_to: ID1 });
    expect(() => build([a, b], makeLogger())).toThrow();
  });
});
