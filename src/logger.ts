import pino from 'pino';
import type { Config, Logger } from './types/index.js';

function wrapPino(pinoLogger: pino.Logger): Logger {
  return {
    trace: (obj, msg) =>
      typeof obj === 'string'
        ? pinoLogger.trace(obj)
        : pinoLogger.trace(obj as Record<string, unknown>, msg),
    debug: (obj, msg) =>
      typeof obj === 'string'
        ? pinoLogger.debug(obj)
        : pinoLogger.debug(obj as Record<string, unknown>, msg),
    info: (obj, msg) =>
      typeof obj === 'string'
        ? pinoLogger.info(obj)
        : pinoLogger.info(obj as Record<string, unknown>, msg),
    warn: (obj, msg) =>
      typeof obj === 'string'
        ? pinoLogger.warn(obj)
        : pinoLogger.warn(obj as Record<string, unknown>, msg),
    error: (obj, msg) =>
      typeof obj === 'string'
        ? pinoLogger.error(obj)
        : pinoLogger.error(obj as Record<string, unknown>, msg),
    child: (bindings) => wrapPino(pinoLogger.child(bindings)),
  };
}

export function createLogger(config: Config): Logger {
  const isDev = process.env.NODE_ENV !== 'production';
  const pinoLogger = pino({
    level: config.LOG_LEVEL,
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
  return wrapPino(pinoLogger);
}
