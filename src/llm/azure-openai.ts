import { AzureOpenAI } from 'openai';
import type { Config, Logger, LlmClient } from '../types/index.js';

export class AzureOpenAiLlmClient implements LlmClient {
  private readonly client: AzureOpenAI;
  private readonly deployment: string;
  private readonly logger: Logger;

  constructor(config: Config, logger: Logger) {
    this.client = new AzureOpenAI({
      endpoint: config.AZURE_OPENAI_ENDPOINT,
      apiKey: config.AZURE_OPENAI_API_KEY,
      apiVersion: config.AZURE_OPENAI_API_VERSION,
    });
    this.deployment = config.AZURE_OPENAI_DEPLOYMENT;
    this.logger = logger;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    this.logger.debug({ deployment: this.deployment }, 'Calling Azure OpenAI');
    const response = await this.client.chat.completions.create({
      model: this.deployment,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned empty response');
    }
    return content;
  }
}
