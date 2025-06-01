import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SidewaysPattern, PriceMovement } from '../../interfaces/analysis.interface';
import { LoggingService } from '../../shared';
import { KlineData } from '../../interfaces/kline.interface';

@Injectable()
export class AnalysisLoggingService {
  private readonly logger = new Logger(AnalysisLoggingService.name);
  private sidewaysCount = 0;
  private lastStatisticsTime = Date.now();
  private readonly statisticsInterval = 60000; // 1 минута

  constructor(
    private configService: ConfigService,
    private googleSheetsLoggingService: LoggingService,
  ) {}

  async logSidewaysPattern(pattern: SidewaysPattern, currentPrice: number): Promise<void> {
    this.sidewaysCount++;
    
    const timestamp = this.formatTimestamp(new Date());
    const symbol = pattern.symbol;
    const direction = pattern.direction === 'high_to_low_to_high' ? 'возврат к максимуму' : 'возврат к минимуму';
    
    const startPrice = this.formatPrice(pattern.startPrice);
    const middlePrice = this.formatPrice(pattern.middlePrice);
    const endPrice = this.formatPrice(pattern.endPrice);

    // Вычисляем процентный диапазон
    const highPrice = Math.max(pattern.startPrice, pattern.middlePrice);
    const lowPrice = Math.min(pattern.startPrice, pattern.middlePrice);
    const rangePercentage = ((highPrice - lowPrice) / lowPrice * 100).toFixed(2);

    console.log(
      `[${timestamp}] [${symbol}] БОКОВИК: ${startPrice} → ${middlePrice} → ${endPrice} (${direction}) | Диапазон: ${rangePercentage}%`
    );

    this.logger.log(`Боковик найден: ${symbol} | ${startPrice} → ${middlePrice} → ${endPrice} | ${rangePercentage}%`);

    // Логируем в Google Sheets
    this.googleSheetsLoggingService.info(
      `Боковик найден: ${symbol} | ${startPrice} → ${middlePrice} → ${endPrice} | ${rangePercentage}%`,
      'AnalysisLoggingService'
    );

    // TODO: Создание торгового сигнала будет добавлено позже
  }

  logActiveMovement(movement: PriceMovement, currentPrice: number): void {
    if (movement.points.length === 0) return;

    const timestamp = this.formatTimestamp(new Date());
    const symbol = movement.symbol;
    
    let statusText = '';
    
    if (movement.points.length === 1) {
      const firstPoint = movement.points[0];
      const firstPrice = this.formatPrice(firstPoint.price);
      const current = this.formatPrice(currentPrice);
      
      if (movement.status === 'waiting_for_low') {
        statusText = `${firstPrice} → ${current} → падает... (ожидание минимума)`;
      } else {
        statusText = `${firstPrice} → ${current} → растет... (ожидание максимума)`;
      }
    } else if (movement.points.length >= 2) {
      const firstPrice = this.formatPrice(movement.points[0].price);
      const secondPrice = this.formatPrice(movement.points[1].price);
      const current = this.formatPrice(currentPrice);
      
      if (movement.status === 'waiting_for_return') {
        const direction = movement.direction === 'high_to_low_to_high' ? 'растет' : 'падает';
        statusText = `${firstPrice} → ${secondPrice} → ${current} ${direction}... (ожидание возврата)`;
      }
    }

    if (statusText) {
      console.log(`[${timestamp}] [${symbol}] Движение: ${statusText}`);
    }
  }

  logStatistics(): void {
    const now = Date.now();
    
    if (now - this.lastStatisticsTime >= this.statisticsInterval) {
      const timestamp = this.formatTimestamp(new Date());
      
      if (this.sidewaysCount > 0) {
        console.log(`[${timestamp}] Найдено боковиков: ${this.sidewaysCount}`);
      } else {
        console.log(`[${timestamp}] Найдено боковиков: 0`);
      }
      
      // TODO: Логирование статистики торговли будет добавлено позже
      
      this.lastStatisticsTime = now;
    }
  }

  /**
   * Обновляет позицию по текущей цене
   */
  updateTradingPositions(symbol: string, currentPrice: number): void {
    // TODO: Обновление позиций будет добавлено позже
  }

  /**
   * Обновляет BTC тренд данными
   */
  updateBTCTrend(kline: KlineData): void {
    // TODO: Обновление BTC тренда будет добавлено позже
  }

  logStartup(symbols: string[]): void {
    const timestamp = this.formatTimestamp(new Date());
    console.log(`[${timestamp}] Запуск анализатора боковиков ФЬЮЧЕРСОВ`);
    console.log(`[${timestamp}] Отслеживаемые фьючерсы: ВСЕ USDT PERPETUAL (${symbols.length} шт.)`);
    console.log(`[${timestamp}] Топ-10: ${symbols.slice(0, 10).join(', ')}`);
    console.log(`[${timestamp}] Таймфрейм: 1m (МИНУТНЫЕ свечи)`);
    console.log(`[${timestamp}] Логика: максимум → минимум → максимум = боковик`);
    console.log(`[${timestamp}] ФИЛЬТР: минимум 2% между верхом и низом`);
    console.log(`[${timestamp}] Анализ: каждую минуту`);
    console.log('─'.repeat(80));

    // Логируем в Google Sheets
    this.googleSheetsLoggingService.info(
      `Анализатор запущен: отслеживается ${symbols.length} символов`,
      'AnalysisLoggingService'
    );
  }

  logError(symbol: string, error: string): void {
    const timestamp = this.formatTimestamp(new Date());
    console.error(`[${timestamp}] [${symbol}] ОШИБКА: ${error}`);
    this.logger.error(`${symbol}: ${error}`);

    // Логируем ошибки в Google Sheets
    this.googleSheetsLoggingService.error(
      `${symbol}: ${error}`,
      'AnalysisLoggingService'
    );
  }

  logConnection(symbol: string, status: 'connected' | 'disconnected' | 'reconnecting'): void {
    const timestamp = this.formatTimestamp(new Date());
    let statusText = '';
    
    switch (status) {
      case 'connected':
        statusText = 'подключено';
        break;
      case 'disconnected':
        statusText = 'отключено';
        break;
      case 'reconnecting':
        statusText = 'переподключение';
        break;
    }
    
    console.log(`[${timestamp}] [${symbol}] WebSocket: ${statusText}`);
  }

  private formatTimestamp(date: Date): string {
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Europe/Moscow'
    });
  }

  private formatPrice(price: number): string {
    // Улучшенное форматирование цен для большей точности
    if (price >= 1000) {
      return price.toFixed(2); // Для больших цен - 2 знака после запятой
    } else if (price >= 1) {
      return price.toFixed(4); // Для средних цен - 4 знака
    } else if (price >= 0.01) {
      return price.toFixed(6); // Для малых цен - 6 знаков
    } else {
      return price.toFixed(8); // Для очень малых цен - 8 знаков
    }
  }

  getSidewaysCount(): number {
    return this.sidewaysCount;
  }

  resetStatistics(): void {
    this.sidewaysCount = 0;
    this.lastStatisticsTime = Date.now();
  }
}
