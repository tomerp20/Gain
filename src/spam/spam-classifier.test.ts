import { describe, it, expect, vi } from 'vitest';
import { LlmSpamClassifier } from './LlmSpamClassifier.js';
import type { Email, LlmClient, Logger } from '../types/index.js';

const ID1 = '00000000-0000-0000-0000-000000000001';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: ID1,
    subject: 'Test Subject',
    from_address: 'sender@example.com',
    to_addresses: ['recipient@example.com'],
    body: 'Test body',
    is_read: false,
    is_sent: false,
    email_direction: 'in',
    in_reply_to: null,
    created_at: '2024-01-01T00:00:00.000Z',
    spam_label: null,
    spam_confidence: null,
    ...overrides,
  };
}

function makeLlm(response: string): LlmClient {
  return { generate: vi.fn().mockResolvedValue(response) };
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

describe('LlmSpamClassifier', () => {
  it('1. well-formed spam response returns { label: "spam", confidence: 0.9 }', async () => {
    const classifier = new LlmSpamClassifier(makeLlm('{"label":"spam","confidence":0.9}'), makeLogger());
    const result = await classifier.classify(makeEmail());
    expect(result).toEqual({ label: 'spam', confidence: 0.9 });
  });

  it('2. well-formed ham response returns { label: "ham", confidence: 0.5 }', async () => {
    const classifier = new LlmSpamClassifier(makeLlm('{"label":"ham","confidence":0.5}'), makeLogger());
    const result = await classifier.classify(makeEmail());
    expect(result).toEqual({ label: 'ham', confidence: 0.5 });
  });

  it('3. malformed JSON returns null sentinel and logs warn', async () => {
    const logger = makeLogger();
    const classifier = new LlmSpamClassifier(makeLlm('not json at all'), logger);
    const result = await classifier.classify(makeEmail());
    expect(result).toEqual({ label: null, confidence: null });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: ID1 }),
      expect.any(String),
    );
  });

  it('4. confidence out of range returns null sentinel', async () => {
    const logger = makeLogger();
    const classifier = new LlmSpamClassifier(makeLlm('{"label":"spam","confidence":1.5}'), logger);
    const result = await classifier.classify(makeEmail());
    expect(result).toEqual({ label: null, confidence: null });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('5. invalid label returns null sentinel', async () => {
    const logger = makeLogger();
    const classifier = new LlmSpamClassifier(makeLlm('{"label":"junk","confidence":0.8}'), logger);
    const result = await classifier.classify(makeEmail());
    expect(result).toEqual({ label: null, confidence: null });
    expect(logger.warn).toHaveBeenCalled();
  });
});
