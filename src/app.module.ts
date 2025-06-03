import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DataModule } from './modules/data/data.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { TradingModule } from './modules/trading/trading.module'; // Добавляем торговый модуль
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    ScheduleModule.forRoot(),
    DataModule,
    AnalysisModule,
    TradingModule, // Добавляем торговый модуль
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
