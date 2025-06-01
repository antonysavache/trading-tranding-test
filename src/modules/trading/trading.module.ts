import { Module } from '@nestjs/common';
import { TradingService } from './trading.service';
import { BTCTrendService } from './btc-trend.service';
import { AnalysisModule } from '../analysis/analysis.module';
import { SharedModule } from '../../shared';

@Module({
  imports: [AnalysisModule, SharedModule],
  providers: [TradingService, BTCTrendService],
  exports: [TradingService, BTCTrendService],
})
export class TradingModule {}
