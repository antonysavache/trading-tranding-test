import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TradingController } from './controllers/trading.controller';
import { DataModule } from './modules/data/data.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { SignalModule } from './modules/signal/signal.module';
import { TradingModule } from './modules/trading/trading.module';
import { SharedModule } from './shared';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    ScheduleModule.forRoot(),
    SharedModule,
    DataModule,
    AnalysisModule,
    SignalModule,
    TradingModule,
  ],
  controllers: [AppController, TradingController],
  providers: [AppService],
})
export class AppModule {}
