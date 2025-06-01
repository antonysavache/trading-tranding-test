import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  trades: number;
}

export interface VolumeAnalysis {
  highVolumeNodes: number[]; // Уровни с высоким объемом
  vpoc: number; // Point of Control (максимальный объем)
  averageVolume: number; // Средний объем для сравнения
  lowVolumeAreas: Array<{ from: number; to: number }>; // Пустые зоны
}

@Injectable()
export class VolumeProfileService {
  private readonly logger = new Logger(VolumeProfileService.name);
  private readonly baseUrl: string;

  // Кэш для Volume Profile (обновляем каждые 30 минут)
  private volumeCache: Map<
    string,
    { data: VolumeAnalysis; timestamp: number }
  > = new Map();
  private readonly cacheTimeout = 30 * 60 * 1000; // 30 минут

  constructor(private configService: ConfigService) {
    this.baseUrl =
      this.configService.get<string>('binance.baseUrl') ||
      'https://fapi.binance.com';
    this.logger.log('Volume Profile Service инициализирован');
  }

  /**
   * Получает Volume Profile для символа
   */
  async getVolumeAnalysis(symbol: string): Promise<VolumeAnalysis> {
    // Проверяем кэш
    const cached = this.volumeCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Строим новый Volume Profile
      const analysis = await this.buildVolumeProfile(symbol);

      // Сохраняем в кэш
      this.volumeCache.set(symbol, {
        data: analysis,
        timestamp: Date.now(),
      });

      return analysis;
    } catch (error) {
      this.logger.error(
        `Ошибка построения Volume Profile для ${symbol}:`,
        (error as Error).message,
      );

      // Возвращаем пустой анализ если не получилось
      return {
        highVolumeNodes: [],
        vpoc: 0,
        averageVolume: 0,
        lowVolumeAreas: [],
      };
    }
  }

  /**
   * Строит Volume Profile на основе исторических свечей
   */
  private async buildVolumeProfile(symbol: string): Promise<VolumeAnalysis> {
    // Получаем данные за последние 6 часов (360 минут)
    const endTime = Date.now();
    const startTime = endTime - 6 * 60 * 60 * 1000;

    // Запрос к Binance API для получения klines (свечей)
    const response = await axios.get(`${this.baseUrl}/fapi/v1/klines`, {
      params: {
        symbol: symbol,
        interval: '1m',
        startTime: startTime,
        endTime: endTime,
        limit: 360,
      },
    });

    const klines = response.data as any[];

    // Строим Volume Profile по ценовым уровням
    const volumeProfile = this.calculateVolumeProfile(klines);

    // Анализируем полученные данные
    return this.analyzeVolumeProfile(volumeProfile, symbol);
  }

  /**
   * Рассчитывает Volume Profile из свечей
   */
  private calculateVolumeProfile(klines: any[]): VolumeProfileLevel[] {
    const profileMap = new Map<string, VolumeProfileLevel>();

    for (const kline of klines) {
      const high = parseFloat(kline[2] as string);
      const low = parseFloat(kline[3] as string);
      const volume = parseFloat(kline[5] as string);
      const trades = parseInt(kline[8] as string, 10);

      // Распределяем объем равномерно по диапазону свечи
      // Для упрощения используем среднюю цену свечи
      const avgPrice = (high + low) / 2;

      // Округляем цену до разумного количества знаков
      const priceKey = this.roundPrice(avgPrice).toString();

      if (profileMap.has(priceKey)) {
        const existing = profileMap.get(priceKey)!;
        existing.volume += volume;
        existing.trades += trades;
      } else {
        profileMap.set(priceKey, {
          price: parseFloat(priceKey),
          volume: volume,
          trades: trades,
        });
      }
    }

    return Array.from(profileMap.values()).sort((a, b) => a.price - b.price);
  }

  /**
   * Анализирует Volume Profile для поиска значимых уровней
   */
  private analyzeVolumeProfile(
    profile: VolumeProfileLevel[],
    symbol: string,
  ): VolumeAnalysis {
    if (profile.length === 0) {
      return {
        highVolumeNodes: [],
        vpoc: 0,
        averageVolume: 0,
        lowVolumeAreas: [],
      };
    }

    // Находим средний объем
    const totalVolume = profile.reduce((sum, level) => sum + level.volume, 0);
    const averageVolume = totalVolume / profile.length;

    // Находим VPOC (Point of Control) - уровень с максимальным объемом
    const vpocLevel = profile.reduce((max, level) =>
      level.volume > max.volume ? level : max,
    );

    // Находим High Volume Nodes (объем > 150% от среднего)
    const highVolumeThreshold = averageVolume * 1.5;
    const highVolumeNodes = profile
      .filter((level) => level.volume > highVolumeThreshold)
      .map((level) => level.price);

    // Находим Low Volume Areas (объем < 50% от среднего)
    const lowVolumeThreshold = averageVolume * 0.5;
    const lowVolumeAreas = this.findLowVolumeAreas(profile, lowVolumeThreshold);

    this.logger.debug(
      `${symbol}: VP построен - HVN: ${highVolumeNodes.length}, VPOC: ${vpocLevel.price.toFixed(4)}`,
    );

    return {
      highVolumeNodes,
      vpoc: vpocLevel.price,
      averageVolume,
      lowVolumeAreas,
    };
  }

  /**
   * Находит области с низким объемом (пустые зоны)
   */
  private findLowVolumeAreas(
    profile: VolumeProfileLevel[],
    threshold: number,
  ): Array<{ from: number; to: number }> {
    const lowVolumeAreas: Array<{ from: number; to: number }> = [];
    let areaStart: number | null = null;

    for (let i = 0; i < profile.length; i++) {
      const level = profile[i];

      if (level.volume < threshold) {
        // Начало пустой зоны
        if (areaStart === null) {
          areaStart = level.price;
        }
      } else {
        // Конец пустой зоны
        if (areaStart !== null) {
          lowVolumeAreas.push({
            from: areaStart,
            to: profile[i - 1]?.price || areaStart,
          });
          areaStart = null;
        }
      }
    }

    // Закрываем последнюю зону если она осталась открытой
    if (areaStart !== null) {
      lowVolumeAreas.push({
        from: areaStart,
        to: profile[profile.length - 1].price,
      });
    }

    return lowVolumeAreas;
  }

  /**
   * Проверяет, находится ли цена рядом с High Volume Node
   */
  isNearHighVolumeNode(
    price: number,
    analysis: VolumeAnalysis,
    tolerance: number = 0.003,
  ): boolean {
    return analysis.highVolumeNodes.some(
      (node) => Math.abs((price - node) / node) <= tolerance,
    );
  }

  /**
   * Проверяет, находится ли диапазон цен в пустой зоне
   */
  isInLowVolumeArea(
    priceFrom: number,
    priceTo: number,
    analysis: VolumeAnalysis,
  ): boolean {
    return analysis.lowVolumeAreas.some(
      (area) => area.from <= priceFrom && area.to >= priceTo,
    );
  }

  /**
   * Округляет цену до разумного количества знаков
   */
  private roundPrice(price: number): number {
    if (price >= 1000) {
      return Math.round(price * 100) / 100; // 2 знака после запятой
    } else if (price >= 1) {
      return Math.round(price * 10000) / 10000; // 4 знака
    } else {
      return Math.round(price * 1000000) / 1000000; // 6 знаков
    }
  }

  /**
   * Очищает старые записи из кэша
   */
  clearOldCache(): void {
    const now = Date.now();
    for (const [symbol, cached] of this.volumeCache.entries()) {
      if (now - cached.timestamp > this.cacheTimeout) {
        this.volumeCache.delete(symbol);
      }
    }
  }
}
