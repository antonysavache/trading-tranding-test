import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface OrderBookLevel {
  price: number;
  quantity: number;
  total: number; // Кумулятивный объем в USDT
}

export interface OrderBookAnalysis {
  symbol: string;
  timestamp: number;
  
  // Основные метрики
  bidAskRatio: number; // BID/ASK объем соотношение
  totalBidVolume: number; // Общий объем покупок (USDT)
  totalAskVolume: number; // Общий объем продаж (USDT)
  spread: number; // Спред в %
  
  // Анализ уровней
  supportStrength: number; // Сила поддержки у текущей цены
  resistanceStrength: number; // Сила сопротивления
  
  // Сигналы
  bullishSignal: boolean; // Бычий сигнал по стакану
  bearishSignal: boolean; // Медвежий сигнал
  strength: 'WEAK' | 'MEDIUM' | 'STRONG';
  
  // Дополнительная информация
  largestBidWall: { price: number; volume: number } | null;
  largestAskWall: { price: number; volume: number } | null;
}

@Injectable()
export class OrderBookAnalysisService {
  private readonly logger = new Logger(OrderBookAnalysisService.name);
  private readonly baseUrl: string;
  
  // Кэш для Order Book (обновляем каждые 10 секунд)
  private orderBookCache: Map<string, { data: OrderBookAnalysis; timestamp: number }> = new Map();
  private readonly cacheTimeout = 10 * 1000; // 10 секунд

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('binance.baseUrl') || 'https://fapi.binance.com';
    this.logger.log('Order Book Analysis Service инициализирован');
  }

  /**
   * Получает анализ Order Book для символа
   */
  async getOrderBookAnalysis(symbol: string): Promise<OrderBookAnalysis> {
    // Проверяем кэш
    const cached = this.orderBookCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Получаем Order Book от Binance
      const analysis = await this.analyzeOrderBook(symbol);
      
      // Сохраняем в кэш
      this.orderBookCache.set(symbol, {
        data: analysis,
        timestamp: Date.now(),
      });

      return analysis;
    } catch (error) {
      this.logger.error(`Ошибка анализа Order Book для ${symbol}:`, (error as Error).message);
      
      // Возвращаем нейтральный анализ
      return this.getNeutralAnalysis(symbol);
    }
  }

  /**
   * Анализирует Order Book
   */
  private async analyzeOrderBook(symbol: string): Promise<OrderBookAnalysis> {
    // Запрос к Binance API для получения Order Book
    const response = await axios.get(`${this.baseUrl}/fapi/v1/depth`, {
      params: {
        symbol: symbol,
        limit: 100, // Получаем первые 100 уровней с каждой стороны
      },
    });

    const orderBook = response.data;
    const bids = orderBook.bids as string[][]; // [[price, quantity], ...]
    const asks = orderBook.asks as string[][]; // [[price, quantity], ...]

    // Получаем текущую цену (лучший bid/ask)
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const currentPrice = (bestBid + bestAsk) / 2;
    const spread = ((bestAsk - bestBid) / currentPrice) * 100;

    // Конвертируем в удобный формат и рассчитываем объемы в USDT
    const bidLevels = this.processOrderBookSide(bids, 'bid');
    const askLevels = this.processOrderBookSide(asks, 'ask');

    // Анализируем в диапазоне ±1% от текущей цены
    const priceRange = currentPrice * 0.01; // 1%
    const relevantBids = bidLevels.filter(level => level.price >= currentPrice - priceRange);
    const relevantAsks = askLevels.filter(level => level.price <= currentPrice + priceRange);

    // Рассчитываем основные метрики
    const totalBidVolume = relevantBids.reduce((sum, level) => sum + level.total, 0);
    const totalAskVolume = relevantAsks.reduce((sum, level) => sum + level.total, 0);
    const bidAskRatio = totalAskVolume > 0 ? totalBidVolume / totalAskVolume : 0;

    // Находим крупнейшие стены
    const largestBidWall = this.findLargestWall(bidLevels, 'bid', currentPrice);
    const largestAskWall = this.findLargestWall(askLevels, 'ask', currentPrice);

    // Оцениваем силу поддержки/сопротивления
    const supportStrength = this.calculateSupportStrength(relevantBids, currentPrice);
    const resistanceStrength = this.calculateResistanceStrength(relevantAsks, currentPrice);

    // Генерируем сигналы
    const { bullishSignal, bearishSignal, strength } = this.generateSignals(
      bidAskRatio,
      supportStrength,
      resistanceStrength,
      totalBidVolume,
      totalAskVolume
    );

    this.logger.debug(
      `${symbol}: OB анализ | Ratio: ${bidAskRatio.toFixed(2)} | ` +
      `BID: $${(totalBidVolume / 1000).toFixed(0)}k | ASK: $${(totalAskVolume / 1000).toFixed(0)}k | ` +
      `Strength: ${strength}`
    );

    return {
      symbol,
      timestamp: Date.now(),
      bidAskRatio,
      totalBidVolume,
      totalAskVolume,
      spread,
      supportStrength,
      resistanceStrength,
      bullishSignal,
      bearishSignal,
      strength,
      largestBidWall,
      largestAskWall,
    };
  }

  /**
   * Обрабатывает одну сторону стакана
   */
  private processOrderBookSide(levels: string[][], side: 'bid' | 'ask'): OrderBookLevel[] {
    return levels.map(level => {
      const price = parseFloat(level[0]);
      const quantity = parseFloat(level[1]);
      const total = price * quantity; // Объем в USDT
      
      return { price, quantity, total };
    });
  }

  /**
   * Находит крупнейшую стену
   */
  private findLargestWall(
    levels: OrderBookLevel[], 
    side: 'bid' | 'ask', 
    currentPrice: number
  ): { price: number; volume: number } | null {
    // Ищем в диапазоне ±2% от текущей цены
    const priceRange = currentPrice * 0.02;
    const minPrice = side === 'bid' ? currentPrice - priceRange : currentPrice;
    const maxPrice = side === 'bid' ? currentPrice : currentPrice + priceRange;

    const relevantLevels = levels.filter(level => 
      level.price >= minPrice && level.price <= maxPrice && level.total >= 10000 // Минимум $10k
    );

    if (relevantLevels.length === 0) return null;

    const largest = relevantLevels.reduce((max, level) => 
      level.total > max.total ? level : max
    );

    return { price: largest.price, volume: largest.total };
  }

  /**
   * Рассчитывает силу поддержки
   */
  private calculateSupportStrength(bids: OrderBookLevel[], currentPrice: number): number {
    // Сила поддержки = объем BID'ов в диапазоне 0.5% ниже текущей цены
    const supportRange = currentPrice * 0.005; // 0.5%
    const supportBids = bids.filter(level => 
      level.price >= currentPrice - supportRange
    );
    
    return supportBids.reduce((sum, level) => sum + level.total, 0);
  }

  /**
   * Рассчитывает силу сопротивления
   */
  private calculateResistanceStrength(asks: OrderBookLevel[], currentPrice: number): number {
    // Сила сопротивления = объем ASK'ов в диапазоне 0.5% выше текущей цены
    const resistanceRange = currentPrice * 0.005; // 0.5%
    const resistanceAsks = asks.filter(level => 
      level.price <= currentPrice + resistanceRange
    );
    
    return resistanceAsks.reduce((sum, level) => sum + level.total, 0);
  }

  /**
   * Генерирует торговые сигналы
   */
  private generateSignals(
    bidAskRatio: number,
    supportStrength: number,
    resistanceStrength: number,
    totalBidVolume: number,
    totalAskVolume: number
  ): { bullishSignal: boolean; bearishSignal: boolean; strength: 'WEAK' | 'MEDIUM' | 'STRONG' } {
    
    // Определяем силу сигнала
    let strength: 'WEAK' | 'MEDIUM' | 'STRONG' = 'WEAK';
    
    if (totalBidVolume > 100000 || totalAskVolume > 100000) { // >$100k
      strength = 'STRONG';
    } else if (totalBidVolume > 50000 || totalAskVolume > 50000) { // >$50k
      strength = 'MEDIUM';
    }

    // Генерируем сигналы
    const bullishSignal = bidAskRatio > 2.0 && supportStrength > 25000; // $25k поддержка
    const bearishSignal = bidAskRatio < 0.5 && resistanceStrength > 25000; // $25k сопротивление

    return { bullishSignal, bearishSignal, strength };
  }

  /**
   * Возвращает нейтральный анализ при ошибке
   */
  private getNeutralAnalysis(symbol: string): OrderBookAnalysis {
    return {
      symbol,
      timestamp: Date.now(),
      bidAskRatio: 1.0,
      totalBidVolume: 0,
      totalAskVolume: 0,
      spread: 0,
      supportStrength: 0,
      resistanceStrength: 0,
      bullishSignal: false,
      bearishSignal: false,
      strength: 'WEAK',
      largestBidWall: null,
      largestAskWall: null,
    };
  }

  /**
   * Проверяет поддерживает ли Order Book направление сделки
   */
  isDirectionSupported(direction: 'LONG' | 'SHORT', analysis: OrderBookAnalysis): boolean {
    if (direction === 'LONG') {
      return analysis.bullishSignal || analysis.bidAskRatio > 1.5;
    } else {
      return analysis.bearishSignal || analysis.bidAskRatio < 0.67;
    }
  }

  /**
   * Очищает старый кэш
   */
  clearOldCache(): void {
    const now = Date.now();
    for (const [symbol, cached] of this.orderBookCache.entries()) {
      if (now - cached.timestamp > this.cacheTimeout * 2) {
        this.orderBookCache.delete(symbol);
      }
    }
  }
}
