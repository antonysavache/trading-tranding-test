import { Injectable, Logger } from '@nestjs/common';
import { KlineData } from '../../interfaces/kline.interface';

export interface BTCTrendAnalysis {
  trend: 'BULLISH' | 'BEARISH';
  ema20: number;
  ema50: number;
  allowLong: boolean;
  allowShort: boolean;
  lastUpdate: number;
}

@Injectable()
export class BTCTrendService {
  private readonly logger = new Logger(BTCTrendService.name);
  
  // Буферы для хранения цен BTC
  private btcPrices: number[] = [];
  private ema20: number = 0;
  private ema50: number = 0;
  private lastTrendAnalysis: BTCTrendAnalysis | null = null;
  
  // Коэффициенты для EMA
  private readonly ema20Multiplier = 2 / (20 + 1); // 0.095
  private readonly ema50Multiplier = 2 / (50 + 1); // 0.039

  constructor() {
    this.logger.log('BTC Trend Service инициализирован');
  }

  /**
   * Обновляет анализ тренда BTC новой свечой
   */
  updateBTCPrice(kline: KlineData): void {
    if (kline.symbol !== 'BTCUSDT') {
      return;
    }

    const closePrice = parseFloat(kline.close);
    this.btcPrices.push(closePrice);

    // Отладочное логирование для первых 5 свечей
    if (this.btcPrices.length <= 5) {
      this.logger.log(`🔧 BTC свеча #${this.btcPrices.length}: ${closePrice.toFixed(2)}`);
    }

    // Ограничиваем буфер (храним последние 100 свечей)
    if (this.btcPrices.length > 100) {
      this.btcPrices.shift();
    }

    // Обновляем EMA
    this.updateEMA(closePrice);

    // Обновляем анализ тренда
    this.updateTrendAnalysis();

    // Логируем прогресс инициализации
    if (this.btcPrices.length === 20) {
      this.logger.log(`📈 BTC EMA20 готова к расчету (${this.btcPrices.length}/50 свечей)`);
    } else if (this.btcPrices.length === 50) {
      this.logger.log(`📈 BTC EMA50 готова! Анализ тренда активирован (${this.btcPrices.length}/50 свечей)`);
    }
  }

  /**
   * Рассчитывает EMA20 и EMA50
   */
  private updateEMA(currentPrice: number): void {
    if (this.btcPrices.length === 1) {
      // Первая цена - инициализируем EMA
      this.ema20 = currentPrice;
      this.ema50 = currentPrice;
    } else if (this.btcPrices.length >= 20) {
      // Обновляем EMA20
      this.ema20 = (currentPrice * this.ema20Multiplier) + (this.ema20 * (1 - this.ema20Multiplier));
    }

    if (this.btcPrices.length >= 50) {
      // Обновляем EMA50
      this.ema50 = (currentPrice * this.ema50Multiplier) + (this.ema50 * (1 - this.ema50Multiplier));
    }
  }

  /**
   * Обновляет анализ тренда на основе EMA
   */
  private updateTrendAnalysis(): void {
    // Изменяем логику: начинаем анализ когда готова EMA20 (20 свечей)
    // EMA50 будет менее точной, но анализ уже возможен
    if (this.btcPrices.length < 20) {
      return;
    }

    // Если EMA50 еще не готова, используем простое скользящее среднее последних 50 цен
    let ema50ForComparison = this.ema50;
    if (this.btcPrices.length < 50) {
      // Используем среднее арифметическое доступных цен (минимум 20)
      const availablePrices = this.btcPrices.slice(-Math.min(this.btcPrices.length, 50));
      ema50ForComparison = availablePrices.reduce((sum, price) => sum + price, 0) / availablePrices.length;
      
      // Логируем временное решение
      if (this.btcPrices.length === 20) {
        this.logger.log(`⚡ BTC ТРЕНД: Временно используем SMA${availablePrices.length} вместо EMA50 для раннего анализа`);
      }
    }

    const trend: 'BULLISH' | 'BEARISH' = this.ema20 > ema50ForComparison ? 'BULLISH' : 'BEARISH';
    const allowLong = trend === 'BULLISH';
    const allowShort = trend === 'BEARISH';

    // Логируем изменение тренда
    if (!this.lastTrendAnalysis || this.lastTrendAnalysis.trend !== trend) {
      const currentPrice = this.btcPrices[this.btcPrices.length - 1];
      const analysisType = this.btcPrices.length >= 50 ? 'EMA50' : `SMA${this.btcPrices.length}`;
      
      this.logger.log(
        `🔄 BTC ТРЕНД ИЗМЕНИЛСЯ: ${trend} | ` +
        `EMA20: ${this.ema20.toFixed(2)} | ${analysisType}: ${ema50ForComparison.toFixed(2)} | ` +
        `Цена: ${currentPrice.toFixed(2)} | ` +
        `LONG: ${allowLong ? '✅' : '❌'} | SHORT: ${allowShort ? '✅' : '❌'}`
      );
    }

    this.lastTrendAnalysis = {
      trend,
      ema20: this.ema20,
      ema50: ema50ForComparison, // Сохраняем то что используем для сравнения
      allowLong,
      allowShort,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Возвращает текущий анализ тренда BTC
   */
  getBTCTrendAnalysis(): BTCTrendAnalysis | null {
    return this.lastTrendAnalysis;
  }

  /**
   * Проверяет, разрешена ли LONG позиция согласно BTC тренду
   */
  isLongAllowed(): boolean {
    if (!this.lastTrendAnalysis) {
      this.logger.debug('BTC тренд еще не инициализирован, разрешаем LONG');
      return true; // Пока нет данных - разрешаем
    }
    return this.lastTrendAnalysis.allowLong;
  }

  /**
   * Проверяет, разрешена ли SHORT позиция согласно BTC тренду
   */
  isShortAllowed(): boolean {
    if (!this.lastTrendAnalysis) {
      this.logger.debug('BTC тренд еще не инициализирован, разрешаем SHORT');
      return true; // Пока нет данных - разрешаем
    }
    return this.lastTrendAnalysis.allowShort;
  }

  /**
   * Проверяет разрешение для конкретного направления
   */
  isDirectionAllowed(direction: 'LONG' | 'SHORT'): boolean {
    return direction === 'LONG' ? this.isLongAllowed() : this.isShortAllowed();
  }

  /**
   * Возвращает информацию о готовности сервиса
   */
  isReady(): boolean {
    return this.lastTrendAnalysis !== null && this.btcPrices.length >= 20;
  }

  /**
   * Логирует текущее состояние BTC тренда
   */
  logCurrentStatus(): void {
    if (!this.lastTrendAnalysis) {
      this.logger.log('📊 BTC ТРЕНД: Еще не инициализирован');
      return;
    }

    const analysis = this.lastTrendAnalysis;
    const currentPrice = this.btcPrices[this.btcPrices.length - 1];
    
    this.logger.log(
      `📊 BTC ТРЕНД: ${analysis.trend} | ` +
      `Цена: ${currentPrice?.toFixed(2)} | ` +
      `EMA20: ${analysis.ema20.toFixed(2)} | EMA50: ${analysis.ema50.toFixed(2)} | ` +
      `LONG: ${analysis.allowLong ? '✅' : '❌'} | SHORT: ${analysis.allowShort ? '✅' : '❌'}`
    );
  }
}
