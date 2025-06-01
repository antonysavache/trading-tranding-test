import { Module } from '@nestjs/common';
import { GoogleSheetsService, LoggingService } from './services';
import { Repository } from './repository';
import { SignalService } from './signal.service';

@Module({
  providers: [GoogleSheetsService, LoggingService, Repository, SignalService],
  exports: [GoogleSheetsService, LoggingService, Repository, SignalService],
})
export class SharedModule {}
