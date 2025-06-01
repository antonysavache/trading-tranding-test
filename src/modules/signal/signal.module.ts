import { Module } from '@nestjs/common';
import { AnalysisLoggingService } from './analysis-logging.service';
import { SharedModule } from '../../shared';

@Module({
  imports: [SharedModule],
  controllers: [],
  providers: [AnalysisLoggingService],
  exports: [AnalysisLoggingService],
})
export class SignalModule {}
