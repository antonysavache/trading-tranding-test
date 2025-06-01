import { Controller, Get } from '@nestjs/common';
import { TrendTradingService } from '../modules/trading/trend-trading.service';
import { TrendAnalysisService } from '../modules/analysis/trend-analysis.service';

@Controller('trend-trading')
export class TrendTradingController {
  constructor(
    private readonly trendTradingService: TrendTradingService,
    private readonly trendAnalysisService: TrendAnalysisService,
  ) {}

  @Get('stats')
  getTradingStats() {
    return this.trendTradingService.getTradingStats();
  }

  @Get('positions/open')
  getOpenPositions() {
    return this.trendTradingService.getOpenPositions();
  }

  @Get('positions/closed')
  getClosedPositions() {
    return this.trendTradingService.getClosedPositions();
  }

  @Get('trends/active')
  getActiveTrends() {
    const movements = this.trendAnalysisService.getActiveTrendMovements();
    return Array.from(movements.entries()).map(([symbol, movement]) => ({
      symbol,
      pointsCount: movement.points.length,
      status: movement.status,
      startTime: movement.startTime,
      trendDirection: movement.trendDirection,
    }));
  }

  @Get('status')
  getStatus() {
    const stats = this.trendTradingService.getTradingStats();
    const openPositions = this.trendTradingService.getOpenPositions();
    const activeTrends = this.trendAnalysisService.getActiveTrendMovements();

    return {
      strategy: 'TREND_TRADING',
      trading: {
        stats,
        openPositions: openPositions.length,
        activeTrends: activeTrends.size,
      },
      recentPositions: openPositions.slice(-10).map(pos => ({
        id: pos.id,
        symbol: pos.symbol,
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        pnl: pos.unrealizedPnl.toFixed(2) + '%',
        entryTime: new Date(pos.entryTime).toISOString(),
        reason: pos.triggerReason,
      })),
      activeMovements: Array.from(activeTrends.entries()).map(([symbol, movement]) => ({
        symbol,
        pointsCount: movement.points.length,
        status: movement.status,
        trendDirection: movement.trendDirection,
      })),
    };
  }
}
