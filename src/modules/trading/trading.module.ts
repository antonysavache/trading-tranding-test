import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { BTCTrendService } from './btc-trend.service';
import { TrendTradingService } from './trend-trading.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { SharedModule } from '../../shared';

@Module({
  imports: [AnalysisModule, SharedModule],
  providers: [TradingService, BTCTrendService, TrendTradingService],
  exports: [TradingService, BTCTrendService, TrendTradingService],
})
export class TradingModule {}
