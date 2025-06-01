import { Module } from '@nestjs/common';
import { PriceAnalysisService } from './price-analysis.service';
import { VolumeProfileService } from './volume-profile.service';
import { OrderBookAnalysisService } from './orderbook-analysis.service';
import { TrendAnalysisService } from './trend-analysis.service';

@Module({
  providers: [PriceAnalysisService, VolumeProfileService, OrderBookAnalysisService, TrendAnalysisService],
  exports: [PriceAnalysisService, VolumeProfileService, OrderBookAnalysisService, TrendAnalysisService],
})
export class AnalysisModule {}
