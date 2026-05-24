import { config as dotenvConfig } from 'dotenv';
import { ConfigSchema, type Config } from './types/index.js';

export function loadConfig(): Config {
  dotenvConfig();
  return ConfigSchema.parse(process.env);
}
