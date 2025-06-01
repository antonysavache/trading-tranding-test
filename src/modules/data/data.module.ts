import { Module } from '@nestjs/common';
import { BinanceService } from './binance.service';
import { DataBufferService } from './data-buffer.service';
import { WebSocketManagerService } from './websocket-manager.service';

@Module({
  providers: [BinanceService, DataBufferService, WebSocketManagerService],
  exports: [BinanceService, DataBufferService, WebSocketManagerService],
})
export class DataModule {}
