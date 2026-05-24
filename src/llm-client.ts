import OpenAI from 'openai';
import type { LlmClient, Config } from './types/index.js';

const SYSTEM_PROMPT = `You are Natalie, a professional and helpful email assistant at a company.
Your job is to write concise, friendly, and contextually appropriate replies to incoming emails.
Read the full conversation thread provided and craft a response that:
- Addresses all questions or requests raised in the most recent message
- Is informed by the entire thread context
- Sounds natural and human
- Is appropriately brief (2-4 short paragraphs unless the topic demands more)
- Does not start with generic openers like "I hope this email finds you well"
Reply with only the email body text — no subject line, no signature.`;

export function createLlmClient(config: Config): LlmClient {
  const client = new OpenAI({
    apiKey: config.AZURE_OPENAI_API_KEY,
    baseURL: `${config.AZURE_OPENAI_ENDPOINT}/openai/deployments/${config.AZURE_OPENAI_DEPLOYMENT}`,
    defaultQuery: { 'api-version': config.AZURE_OPENAI_API_VERSION },
    defaultHeaders: { 'api-key': config.AZURE_OPENAI_API_KEY },
  });

  return {
    async generate(systemPrompt: string, userPrompt: string): Promise<string> {
      const completion = await client.chat.completions.create({
        model: config.AZURE_OPENAI_DEPLOYMENT,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) throw new Error('LLM returned empty response');
      return content.trim();
    },
  };
}

export function buildThreadPrompt(subject: string, messages: Array<{ from: string; body: string; date: string }>): { system: string; user: string } {
  const threadText = messages
    .map((m, i) => `--- Message ${i + 1} (from: ${m.from}, date: ${m.date}) ---\n${m.body}`)
    .join('\n\n');

  return {
    system: SYSTEM_PROMPT,
    user: `Subject: ${subject}\n\nConversation thread (oldest first):\n\n${threadText}\n\nPlease write a reply to the most recent message above.`,
  };
}
