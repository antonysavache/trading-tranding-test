import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KlineData } from '../../interfaces/kline.interface';

@Injectable()
export class DataBufferService {
  private readonly logger = new Logger(DataBufferService.name);
  private readonly klineBuffers: Map<string, KlineData[]> = new Map();
  private readonly bufferSize: number;

  constructor(private configService: ConfigService) {
    this.bufferSize = this.configService.get<number>('analysis.bufferSize', 200);
  }

  addKline(kline: KlineData): void {
    if (!this.klineBuffers.has(kline.symbol)) {
      this.klineBuffers.set(kline.symbol, []);
    }

    const buffer = this.klineBuffers.get(kline.symbol)!;
    buffer.push(kline);

    // Ограничиваем размер буфера
    if (buffer.length > this.bufferSize) {
      buffer.shift();
    }

    // Убрали debug лог - слишком много шума
  }

  getKlines(symbol: string, count?: number): KlineData[] {
    const buffer = this.klineBuffers.get(symbol) || [];
    
    if (count && count > 0) {
      return buffer.slice(-count);
    }
    
    return [...buffer];
  }

  getLatestKline(symbol: string): KlineData | null {
    const buffer = this.klineBuffers.get(symbol);
    return buffer && buffer.length > 0 ? buffer[buffer.length - 1] : null;
  }

  hasEnoughData(symbol: string, minCount: number = 10): boolean {
    const buffer = this.klineBuffers.get(symbol);
    return buffer ? buffer.length >= minCount : false;
  }

  getBufferStats(): { [symbol: string]: number } {
    const stats: { [symbol: string]: number } = {};
    
    this.klineBuffers.forEach((buffer, symbol) => {
      stats[symbol] = buffer.length;
    });

    return stats;
  }

  clearBuffer(symbol?: string): void {
    if (symbol) {
      this.klineBuffers.delete(symbol);
      this.logger.log(`Буфер ${symbol} очищен`);
    } else {
      this.klineBuffers.clear();
      this.logger.log('Все буферы очищены');
    }
  }
}
