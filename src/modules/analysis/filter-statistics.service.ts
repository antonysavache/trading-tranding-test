import { Injectable, Logger } from '@nestjs/common';

interface FilterStats {
  symbol: string;
  timestamp: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  trendStrength: number;
  allowLong: boolean;
  allowShort: boolean;
  reason: string;
  positionTaken: 'LONG' | 'SHORT' | 'NONE';
  actualDirection?: 'LONG' | 'SHORT';
}

@Injectable()
export class FilterStatisticsService {
  private readonly logger = new Logger(FilterStatisticsService.name);
  private readonly filterStats: FilterStats[] = [];

  // Записываем статистику фильтров
  recordFilterDecision(
    symbol: string,
    trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS',
    trendStrength: number,
    allowLong: boolean,
    allowShort: boolean,
    reason: string,
    actualDirection?: 'LONG' | 'SHORT'
  ): void {
    const stats: FilterStats = {
      symbol,
      timestamp: Date.now(),
      trendDirection,
      trendStrength,
      allowLong,
      allowShort,
      reason,
      positionTaken: actualDirection || 'NONE',
      actualDirection,
    };

    this.filterStats.push(stats);

    // Ограничиваем размер массива
    if (this.filterStats.length > 1000) {
      this.filterStats.splice(0, 100); // Удаляем старые записи
    }
  }

  // Получаем статистику эффективности фильтров
  getFilterEffectiveness(): any {
    if (this.filterStats.length === 0) return null;

    const total = this.filterStats.length;
    
    // Статистика по трендам
    const bullishTrend = this.filterStats.filter(s => s.trendDirection === 'BULLISH').length;
    const bearishTrend = this.filterStats.filter(s => s.trendDirection === 'BEARISH').length;
    const sidewaysTrend = this.filterStats.filter(s => s.trendDirection === 'SIDEWAYS').length;

    // Сколько раз фильтры заблокировали LONG/SHORT
    const longBlocked = this.filterStats.filter(s => !s.allowLong && s.actualDirection === 'LONG').length;
    const shortBlocked = this.filterStats.filter(s => !s.allowShort && s.actualDirection === 'SHORT').length;

    // Сколько раз фильтры разрешили торговлю
    const longAllowed = this.filterStats.filter(s => s.allowLong && s.actualDirection === 'LONG').length;
    const shortAllowed = this.filterStats.filter(s => s.allowShort && s.actualDirection === 'SHORT').length;

    return {
      total,
      trendDistribution: {
        bullish: (bullishTrend / total * 100).toFixed(1) + '%',
        bearish: (bearishTrend / total * 100).toFixed(1) + '%',
        sideways: (sidewaysTrend / total * 100).toFixed(1) + '%',
      },
      filterActions: {
        longBlocked,
        shortBlocked,
        longAllowed,
        shortAllowed,
      },
      recentSamples: this.filterStats.slice(-10), // Последние 10 записей
    };
  }

  // Логируем периодическую статистику
  logPeriodicStats(): void {
    const stats = this.getFilterEffectiveness();
    if (!stats) return;

    this.logger.log(
      `📊 СТАТИСТИКА ФИЛЬТРОВ | ` +
      `Всего записей: ${stats.total} | ` +
      `Тренды: BULL ${stats.trendDistribution.bullish}, BEAR ${stats.trendDistribution.bearish}, SIDE ${stats.trendDistribution.sideways} | ` +
      `Заблокировано: LONG ${stats.filterActions.longBlocked}, SHORT ${stats.filterActions.shortBlocked}`
    );
  }
}
