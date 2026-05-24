import { z } from 'zod';
import type { Email, LlmClient, Logger, SpamClassifier } from '../types/index.js';

const SpamResponseSchema = z.object({
  label: z.enum(['spam', 'ham']),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT =
  'You are a spam classifier. Given an email, return exactly one JSON object: ' +
  '{"label": "spam" | "ham", "confidence": <number between 0 and 1>}. ' +
  'No other output. ' +
  "'spam' means unsolicited junk, phishing, scams, or adversarial outreach. " +
  "'ham' means legitimate business correspondence.";

export class LlmSpamClassifier implements SpamClassifier {
  constructor(
    private readonly llm: LlmClient,
    private readonly logger: Logger,
  ) {}

  async classify(email: Email): Promise<{ label: 'spam' | 'ham' | null; confidence: number | null }> {
    const userPrompt = `From: ${email.from_address}\nSubject: ${email.subject}\n\n${email.body}`;

    let raw: string;
    try {
      raw = await this.llm.generate(SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      this.logger.warn({ emailId: email.id, err }, 'LLM call failed during spam classification');
      return { label: null, confidence: null };
    }

    let jsonObj: unknown;
    try {
      jsonObj = JSON.parse(raw.trim());
    } catch {
      this.logger.warn({ emailId: email.id, raw }, 'Spam classifier response is not valid JSON');
      return { label: null, confidence: null };
    }

    const result = SpamResponseSchema.safeParse(jsonObj);
    if (!result.success) {
      this.logger.warn({ emailId: email.id, raw }, 'Spam classifier response failed schema validation');
      return { label: null, confidence: null };
    }

    return result.data;
  }
}
