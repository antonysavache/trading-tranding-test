import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VirtualTradingService } from './virtual-trading.service';

@Module({
  imports: [ConfigModule],
  providers: [VirtualTradingService],
  exports: [VirtualTradingService],
})
export class TradingModule {}
