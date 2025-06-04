import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlineData } from '../../interfaces/kline.interface';
import { PricePoint, PriceMovement, SidewaysPattern } from '../../interfaces/analysis.interface';
import { VirtualTradingService } from '../trading/virtual-trading.service';
import { TrendAnalysisService } from './trend-analysis.service';
import { FilterStatisticsService } from './filter-statistics.service';

@Injectable()
export class PriceAnalysisService {
  private readonly logger = new Logger(PriceAnalysisService.name);
  private readonly lookbackPeriod: number;
  private readonly minPriceMovement: number;
  private readonly returnThreshold: number;
  private readonly minChannelWidthPercent: number;
  
  // Хранилище активных движений для каждого символа
  private readonly activeMovements: Map<string, PriceMovement> = new Map();

  constructor(
    private configService: ConfigService,
    private virtualTradingService: VirtualTradingService,
    private trendAnalysisService: TrendAnalysisService,
    private filterStatisticsService: FilterStatisticsService, // Добавляем сервис статистики
  ) {
    this.lookbackPeriod = this.configService.get<number>('analysis.lookbackPeriod', 3);
    this.minPriceMovement = this.configService.get<number>('analysis.minPriceMovement', 0.0005);
    this.returnThreshold = this.configService.get<number>('analysis.returnThreshold', 0.001);
    this.minChannelWidthPercent = this.configService.get<number>('analysis.minChannelWidthPercent', 2.0);
  }

  async analyzeKlines(klines: KlineData[]): Promise<SidewaysPattern[]> {
    if (klines.length < this.lookbackPeriod * 2 + 1) {
      return [];
    }

    const symbol = klines[0]?.symbol;
    if (!symbol) return [];

    const patterns: SidewaysPattern[] = [];
    
    // Анализируем ВСЕ доступные данные для поиска качественных боковиков
    // Используем все накопленные свечи (до bufferSize = 60 свечей = 5 часов)
    const recentKlines = klines; // Все доступные данные вместо slice(-12)
    
    // Находим локальные максимумы и минимумы
    const pricePoints = this.findLocalExtremes(recentKlines);
    
    if (pricePoints.length === 0) {
      return patterns;
    }

    // Обновляем активное движение или создаем новое
    this.updateMovement(symbol, pricePoints, recentKlines);
    
    // Проверяем на завершенный боковик 
    const completedPattern = await this.checkForSidewaysCompletion(symbol, recentKlines);
    if (completedPattern) {
      patterns.push(completedPattern);
      
      // НОВОЕ: Анализируем фильтры БЕЗ их применения (только для статистики)
      const currentPrice = parseFloat(recentKlines[recentKlines.length - 1].close);
      try {
        const trendAnalysis = this.trendAnalysisService.analyzeTrend(recentKlines);
        const marketFilter = this.trendAnalysisService.checkMarketFilters(symbol, trendAnalysis, recentKlines[recentKlines.length - 1]);
        
        // Определяем какую позицию мы собираемся открыть
        const direction = this.getTradeDirection(completedPattern, currentPrice);
        
        // Записываем статистику фильтров
        this.filterStatisticsService.recordFilterDecision(
          symbol,
          trendAnalysis.direction,
          trendAnalysis.strength,
          marketFilter.allowLong,
          marketFilter.allowShort,
          marketFilter.reason,
          direction
        );
        
        // Логируем что показали бы фильтры (но НЕ применяем их)
        this.logger.log(
          `${symbol}: 📊 ФИЛЬТРЫ (статистика) | ` +
          `Тренд: ${trendAnalysis.direction} (${trendAnalysis.strength.toFixed(1)}%) | ` +
          `Планируем: ${direction} | ` +
          `Фильтр разрешил бы: LONG=${marketFilter.allowLong ? '✅' : '❌'} SHORT=${marketFilter.allowShort ? '✅' : '❌'} | ` +
          `${marketFilter.reason}`
        );
        
        // Отправляем паттерн в торговый модуль БЕЗ фильтров, но С информацией о них
        await this.virtualTradingService.processPattern(completedPattern, currentPrice, {
          trendDirection: trendAnalysis.direction,
          trendStrength: trendAnalysis.strength,
          allowLong: marketFilter.allowLong,
          allowShort: marketFilter.allowShort,
          reason: marketFilter.reason,
          details: marketFilter.filters,
        });
      } catch (error) {
        this.logger.warn(`${symbol}: Ошибка анализа фильтров: ${error.message}`);
        // Если фильтры не работают - продолжаем торговать как раньше
        await this.virtualTradingService.processPattern(completedPattern, currentPrice);
      }
    }

    return patterns;
  }

  // НОВОЕ: Обработка свечи для проверки торговых позиций
  async processKlineForTrading(kline: KlineData): Promise<void> {
    await this.virtualTradingService.checkPositionsOnCandle(kline);
  }

  private findLocalExtremes(klines: KlineData[]): PricePoint[] {
    const points: PricePoint[] = [];
    
    // Анализируем все доступные свечи, исключая края для корректного сравнения
    for (let i = this.lookbackPeriod; i < klines.length - this.lookbackPeriod; i++) {
      const current = klines[i];
      const currentHigh = parseFloat(current.high);
      const currentLow = parseFloat(current.low);
      
      // Проверяем на локальный максимум
      if (this.isLocalHigh(klines, i)) {
        points.push({
          price: currentHigh,
          timestamp: current.closeTime,
          type: 'high',
          index: i,
        });
      }
      
      // Проверяем на локальный минимум
      if (this.isLocalLow(klines, i)) {
        points.push({
          price: currentLow,
          timestamp: current.closeTime,
          type: 'low',
          index: i,
        });
      }
    }

    // Сортируем по времени и возвращаем все найденные точки
    const sortedPoints = points.sort((a, b) => a.timestamp - b.timestamp);
    
    // Логируем количество найденных экстремумов для мониторинга
    if (sortedPoints.length > 0) {
      const symbol = klines[0]?.symbol;
      this.logger.debug(`${symbol}: Найдено ${sortedPoints.length} экстремумов за ${klines.length} свечей (${(klines.length * 5)} минут)`);
    }
    
    return sortedPoints;
  }

  private isLocalHigh(klines: KlineData[], index: number): boolean {
    const currentHigh = parseFloat(klines[index].high);
    
    // Проверяем, что текущий максимум выше соседних свечей
    for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
      if (i !== index && i >= 0 && i < klines.length) {
        if (parseFloat(klines[i].high) >= currentHigh) {
          return false;
        }
      }
    }
    
    return true;
  }

  private isLocalLow(klines: KlineData[], index: number): boolean {
    const currentLow = parseFloat(klines[index].low);
    
    // Проверяем, что текущий минимум ниже соседних свечей
    for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
      if (i !== index && i >= 0 && i < klines.length) {
        if (parseFloat(klines[i].low) <= currentLow) {
          return false;
        }
      }
    }
    
    return true;
  }

  private updateMovement(symbol: string, pricePoints: PricePoint[], klines: KlineData[]): void {
    if (pricePoints.length === 0) return;

    let movement = this.activeMovements.get(symbol);
    const latestPoint = pricePoints[pricePoints.length - 1];
    const currentPrice = parseFloat(klines[klines.length - 1].close);

    if (!movement) {
      // Начинаем новое движение с первой найденной точки
      movement = {
        symbol,
        points: [latestPoint],
        status: latestPoint.type === 'high' ? 'waiting_for_low' : 'waiting_for_high',
        startTime: latestPoint.timestamp,
        direction: latestPoint.type === 'high' ? 'high_to_low_to_high' : 'low_to_high_to_low',
      };
      
      this.activeMovements.set(symbol, movement);
      this.logger.log(`${symbol}: 🟡 Начато движение от ${latestPoint.type} ${latestPoint.price.toFixed(4)}`);
      return;
    }

    // Обновляем существующее движение
    const lastPoint = movement.points[movement.points.length - 1];
    
    // Добавляем новую точку если она соответствует ожидаемому направлению
    if (this.shouldAddPoint(movement, latestPoint)) {
      movement.points.push(latestPoint);
      this.updateMovementStatus(movement, currentPrice);
      
      this.logger.log(`${symbol}: ➕ Добавлена точка ${latestPoint.type} ${latestPoint.price.toFixed(4)}, статус: ${movement.status}`);
    }
  }

  private shouldAddPoint(movement: PriceMovement, newPoint: PricePoint): boolean {
    const lastPoint = movement.points[movement.points.length - 1];
    
    // Не добавляем точку того же типа подряд
    if (lastPoint.type === newPoint.type) {
      return false;
    }

    // Предварительная проверка на минимальное движение (настраивается в конфиге)
    if (movement.points.length === 1) {
      const priceRange = Math.abs(newPoint.price - lastPoint.price);
      const rangePercentage = (priceRange / Math.min(newPoint.price, lastPoint.price)) * 100;
      
      // Если движение меньше минимальной ширины канала, не добавляем точку
      if (rangePercentage < this.minChannelWidthPercent) {
        return false;
      }
    }

    // Проверяем соответствие ожидаемому направлению
    switch (movement.status) {
      case 'waiting_for_low':
        return newPoint.type === 'low';
      case 'waiting_for_high':
        return newPoint.type === 'high';
      default:
        return false;
    }
  }

  private updateMovementStatus(movement: PriceMovement, currentPrice: number): void {
    switch (movement.status) {
      case 'waiting_for_low':
        if (movement.points.length >= 2) {
          movement.status = 'waiting_for_return';
        }
        break;
      case 'waiting_for_high':
        if (movement.points.length >= 2) {
          movement.status = 'waiting_for_return';
        }
        break;
    }
  }

  private async checkForSidewaysCompletion(symbol: string, klines: KlineData[]): Promise<SidewaysPattern | null> {
    const movement = this.activeMovements.get(symbol);
    
    if (!movement || movement.status !== 'waiting_for_return' || movement.points.length < 2) {
      return null;
    }

    const currentPrice = parseFloat(klines[klines.length - 1].close);
    const firstPoint = movement.points[0];
    const secondPoint = movement.points[1];

    // ВАЖНО: Проверяем что расстояние между верхом и низом больше минимальной ширины канала
    const highPrice = Math.max(firstPoint.price, secondPoint.price);
    const lowPrice = Math.min(firstPoint.price, secondPoint.price);
    const priceRange = Math.abs(highPrice - lowPrice);
    const rangePercentage = (priceRange / lowPrice) * 100;

    // Если расстояние меньше минимальной ширины канала - не считаем боковиком
    if (rangePercentage < this.minChannelWidthPercent) {
      this.logger.debug(`${symbol}: движение ${rangePercentage.toFixed(2)}% меньше минимума ${this.minChannelWidthPercent}%`);
      return null;
    }

    // Проверяем возврат к первоначальному уровню
    const returnThreshold = firstPoint.price * this.returnThreshold;
    const priceDistance = Math.abs(currentPrice - firstPoint.price);

    if (priceDistance <= returnThreshold) {
      this.logger.log(`${symbol}: 🎯 БОКОВИК найден! Диапазон: ${rangePercentage.toFixed(2)}% | LOW: ${lowPrice.toFixed(6)} | HIGH: ${highPrice.toFixed(6)} | CURRENT: ${currentPrice.toFixed(6)}`);
      
      // Создаем окончательный паттерн
      const finalPattern: SidewaysPattern = {
        symbol,
        startPrice: firstPoint.price,
        middlePrice: secondPoint.price,
        endPrice: currentPrice,
        startTime: firstPoint.timestamp,
        endTime: Date.now(),
        direction: movement.direction,
        pricePoints: [...movement.points],
        channelWidthPercent: rangePercentage,
        highLevel: highPrice,
        lowLevel: lowPrice,
      };

      // Очищаем активное движение
      this.activeMovements.delete(symbol);
      
      this.logger.log(`${symbol}: 🎯 БОКОВИК НАЙДЕН | Ширина: ${rangePercentage.toFixed(2)}%`);
      
      return finalPattern;
    }

    return null;
  }

  getActiveMovements(): Map<string, PriceMovement> {
    return new Map(this.activeMovements);
  }

  clearMovement(symbol: string): void {
    this.activeMovements.delete(symbol);
  }

  clearAllMovements(): void {
    this.activeMovements.clear();
  }

  // Определение направления сделки на основе паттерна (скопировано из торгового сервиса)
  private getTradeDirection(pattern: SidewaysPattern, currentPrice: number): 'LONG' | 'SHORT' {
    const distanceToHigh = Math.abs(currentPrice - pattern.highLevel);
    const distanceToLow = Math.abs(currentPrice - pattern.lowLevel);
    
    if (distanceToHigh < distanceToLow) {
      return 'SHORT'; // Цена у верхней границы, ожидаем отскок вниз
    } else {
      return 'LONG'; // Цена у нижней границы, ожидаем отскок вверх
    }
  }
}
