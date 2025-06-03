import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PriceAnalysisService } from './price-analysis.service';
import { TradingModule } from '../trading/trading.module'; // Импортируем торговый модуль

@Module({
  imports: [
    ConfigModule,
    TradingModule, // Добавляем торговый модуль
  ],
  providers: [PriceAnalysisService],
  exports: [PriceAnalysisService],
})
export class AnalysisModule {}
