import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PriceAnalysisService } from './price-analysis.service';
import { TrendAnalysisService } from './trend-analysis.service';
import { FilterStatisticsService } from './filter-statistics.service';
import { TradingModule } from '../trading/trading.module'; // Импортируем торговый модуль

@Module({
  imports: [
    ConfigModule,
    TradingModule, // Добавляем торговый модуль
  ],
  providers: [
    PriceAnalysisService, 
    TrendAnalysisService,
    FilterStatisticsService, // Добавляем сервис статистики
  ],
  exports: [
    PriceAnalysisService,
    TrendAnalysisService,
    FilterStatisticsService, // Экспортируем сервис статистики
  ],
})
export class AnalysisModule {}
