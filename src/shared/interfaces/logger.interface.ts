/**
 * Базовый интерфейс для логирования
 */
export interface ILogger {
  info(message: string, source?: string): void;
  warn(message: string, source?: string): void;
  error(message: string, source?: string): void;
  debug(message: string, source?: string): void;
}

/**
 * Простой логгер в консоль, реализующий интерфейс ILogger
 */
export class ConsoleLogger implements ILogger {
  info(message: string, source?: string): void {
    console.log(`[INFO] ${source ? `[${source}] ` : ''}${message}`);
  }

  warn(message: string, source?: string): void {
    console.warn(`[WARNING] ${source ? `[${source}] ` : ''}${message}`);
  }

  error(message: string, source?: string): void {
    console.error(`[ERROR] ${source ? `[${source}] ` : ''}${message}`);
  }

  debug(message: string, source?: string): void {
    console.debug(`[DEBUG] ${source ? `[${source}] ` : ''}${message}`);
  }
}
