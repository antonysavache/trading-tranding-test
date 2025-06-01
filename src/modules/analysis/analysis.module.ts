import { Module } from '@nestjs/common';
import { PriceAnalysisService } from './price-analysis.service';
import { VolumeProfileService } from './volume-profile.service';
import { OrderBookAnalysisService } from './orderbook-analysis.service';

@Module({
  providers: [PriceAnalysisService, VolumeProfileService, OrderBookAnalysisService],
  exports: [PriceAnalysisService, VolumeProfileService, OrderBookAnalysisService],
})
export class AnalysisModule {}
