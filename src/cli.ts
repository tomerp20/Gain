import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config);
logger.info({ config }, 'Config loaded');
