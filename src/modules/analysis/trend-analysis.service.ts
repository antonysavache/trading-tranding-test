import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlineData } from '../../interfaces/kline.interface';
import { TrendAnalysis, MarketFilter } from '../../interfaces/analysis.interface';

@Injectable()
export class TrendAnalysisService {
  private readonly logger = new Logger(TrendAnalysisService.name);
  private readonly trendFilterEnabled: boolean;
  private readonly volumeFilterEnabled: boolean;
  private readonly timeFilterEnabled: boolean;
  private readonly volatilityFilterEnabled: boolean;
  private readonly allowedHours: number[];
  private readonly excludeWeekends: boolean;

  constructor(private configService: ConfigService) {
    this.trendFilterEnabled = this.configService.get<boolean>('analysis.trendFilter.enabled', true);
    this.volumeFilterEnabled = this.configService.get<boolean>('analysis.volumeFilter.enabled', true);
    this.timeFilterEnabled = this.configService.get<boolean>('analysis.timeFilter.enabled', true);
    this.volatilityFilterEnabled = this.configService.get<boolean>('analysis.volatilityFilter.enabled', true);
    this.allowedHours = this.configService.get<number[]>('analysis.timeFilter.allowedHours', [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    this.excludeWeekends = this.configService.get<boolean>('analysis.timeFilter.excludeWeekends', true);
    
    this.logger.log(`📊 Трендовый анализ инициализирован`);
    this.logger.log(`🔄 Фильтры: Тренд=${this.trendFilterEnabled}, Объем=${this.volumeFilterEnabled}, Время=${this.timeFilterEnabled}, Волатильность=${this.volatilityFilterEnabled}`);
  }

  // Анализ тренда по EMA
  analyzeTrend(klines: KlineData[]): TrendAnalysis {
    const closes = klines.map(k => parseFloat(k.close));
    const highs = klines.map(k => parseFloat(k.high));
    const lows = klines.map(k => parseFloat(k.low));
    const volumes = klines.map(k => parseFloat(k.volume));
    
    // Рассчитываем EMA
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, 200);
    
    // Рассчитываем ATR для волатильности
    const atr = this.calculateATR(highs, lows, closes, 14);
    
    // Средний объем
    const avgVolume = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
    
    // Определяем направление тренда
    const currentPrice = closes[closes.length - 1];
    const direction = this.getTrendDirection(currentPrice, ema20, ema50, ema200);
    
    // Рассчитываем силу тренда
    const strength = this.calculateTrendStrength(currentPrice, ema20, ema50, ema200);
    
    return {
      direction,
      strength,
      ema20,
      ema50,
      ema200,
      atr,
      volume: avgVolume,
    };
  }

  // Проверка фильтров для торговли
  checkMarketFilters(symbol: string, trendAnalysis: TrendAnalysis, currentKline: KlineData): MarketFilter {
    let allowLong = true;
    let allowShort = true;
    let reason = 'Все фильтры пройдены';
    
    // 1. Фильтр тренда
    if (this.trendFilterEnabled) {
      const trendStrengthThreshold = this.configService.get<number>('analysis.trendFilter.trendStrengthThreshold', 30);
      
      if (trendAnalysis.strength > trendStrengthThreshold) {
        if (trendAnalysis.direction === 'BULLISH') {
          allowShort = false;
          reason = `Сильный восходящий тренд (${trendAnalysis.strength.toFixed(1)}%), только LONG`;
        } else if (trendAnalysis.direction === 'BEARISH') {
          allowLong = false;
          reason = `Сильный нисходящий тренд (${trendAnalysis.strength.toFixed(1)}%), только SHORT`;
        }
      }
    }

    // 2. Фильтр времени
    if (this.timeFilterEnabled) {
      const currentHour = new Date().getUTCHours();
      const currentDay = new Date().getUTCDay(); // 0 = воскресенье, 6 = суббота
      
      if (this.excludeWeekends && (currentDay === 0 || currentDay === 6)) {
        allowLong = false;
        allowShort = false;
        reason = 'Выходные дни - торговля отключена';
      } else if (!this.allowedHours.includes(currentHour)) {
        allowLong = false;
        allowShort = false;
        reason = `Неподходящее время для торговли (${currentHour}:00 UTC)`;
      }
    }

    // 3. Фильтр объема
    if (this.volumeFilterEnabled) {
      const minVolumeMultiplier = this.configService.get<number>('analysis.volumeFilter.minVolumeMultiplier', 0.5);
      const currentVolume = parseFloat(currentKline.volume);
      
      if (currentVolume < trendAnalysis.volume * minVolumeMultiplier) {
        allowLong = false;
        allowShort = false;
        reason = 'Низкий объем торгов';
      }
    }

    // 4. Фильтр волатильности
    if (this.volatilityFilterEnabled) {
      const minAtrMultiplier = this.configService.get<number>('analysis.volatilityFilter.minAtrMultiplier', 0.3);
      const maxAtrMultiplier = this.configService.get<number>('analysis.volatilityFilter.maxAtrMultiplier', 3.0);
      const avgAtr = trendAnalysis.atr;
      
      if (avgAtr < parseFloat(currentKline.close) * 0.001 * minAtrMultiplier) {
        allowLong = false;
        allowShort = false;
        reason = 'Слишком низкая волатильность';
      } else if (avgAtr > parseFloat(currentKline.close) * 0.001 * maxAtrMultiplier) {
        allowLong = false;
        allowShort = false;
        reason = 'Слишком высокая волатильность';
      }
    }

    const volatility = this.getVolatilityLevel(trendAnalysis.atr, parseFloat(currentKline.close));
    const marketHours = this.isGoodMarketTime();

    return {
      allowLong,
      allowShort,
      reason,
      trendDirection: trendAnalysis.direction,
      marketHours,
      volatility,
    };
  }

  // Расчет EMA
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
  }

  // Расчет ATR (Average True Range)
  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;
    
    const trueRanges: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];
      
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    // Возвращаем среднее значение за period
    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }

  // Определение направления тренда
  private getTrendDirection(price: number, ema20: number, ema50: number, ema200: number): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
      return 'BULLISH';
    } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
      return 'BEARISH';
    } else {
      return 'SIDEWAYS';
    }
  }

  // Расчет силы тренда (0-100)
  private calculateTrendStrength(price: number, ema20: number, ema50: number, ema200: number): number {
    // Расстояние между EMA как показатель силы тренда
    const ema20_50_distance = Math.abs((ema20 - ema50) / ema50) * 100;
    const ema50_200_distance = Math.abs((ema50 - ema200) / ema200) * 100;
    const price_ema20_distance = Math.abs((price - ema20) / ema20) * 100;
    
    // Средняя сила = среднее расстояние между EMA
    const strength = (ema20_50_distance + ema50_200_distance + price_ema20_distance) / 3;
    
    return Math.min(100, strength * 10); // Масштабируем до 0-100
  }

  // Определение уровня волатильности
  private getVolatilityLevel(atr: number, price: number): 'LOW' | 'NORMAL' | 'HIGH' {
    const atrPercent = (atr / price) * 100;
    
    if (atrPercent < 0.5) return 'LOW';
    if (atrPercent > 2.0) return 'HIGH';
    return 'NORMAL';
  }

  // Проверка хорошего времени для торговли
  private isGoodMarketTime(): boolean {
    const currentHour = new Date().getUTCHours();
    const currentDay = new Date().getUTCDay();
    
    if (this.excludeWeekends && (currentDay === 0 || currentDay === 6)) {
      return false;
    }
    
    return this.allowedHours.includes(currentHour);
  }
}
