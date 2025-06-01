import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as WebSocket from 'ws';
import { BinanceKlineData, KlineData } from '../../interfaces/kline.interface';

@Injectable()
export class WebSocketManagerService {
  private readonly logger = new Logger(WebSocketManagerService.name);
  private wsConnections: Map<string, WebSocket> = new Map();
  private readonly maxConnectionsPerSocket = 20; // Сильно уменьшим для стабильности

  constructor(private configService: ConfigService) {}

  subscribeToMultipleKlines(
    symbols: string[],
    onKline: (kline: KlineData) => void,
    onError?: (error: Error) => void
  ): void {
    const wsUrl = this.configService.get<string>('binance.wsUrl');
    const interval = this.configService.get<string>('binance.interval');

    if (!wsUrl || !interval) {
      throw new Error('WebSocket URL или интервал не настроены');
    }

    // Разбиваем символы на группы для разных WebSocket соединений
    const symbolGroups = this.chunkArray(symbols, this.maxConnectionsPerSocket);
    
    this.logger.log(`Создание ${symbolGroups.length} WebSocket соединений для ${symbols.length} пар`);

    symbolGroups.forEach((symbolGroup, index) => {
      this.createMultiStreamConnection(symbolGroup, index, wsUrl, interval, onKline, onError);
    });
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private createMultiStreamConnection(
    symbols: string[],
    connectionIndex: number,
    wsUrl: string,
    interval: string,
    onKline: (kline: KlineData) => void,
    onError?: (error: Error) => void
  ): void {
    // Ограничиваем количество потоков до 50 на подключение (лимит Binance)
    const limitedSymbols = symbols.slice(0, 50);
    
    // Создаем список потоков для фьючерсных kline
    const streams = limitedSymbols.map(symbol => `${symbol.toLowerCase()}@kline_${interval}`);
    
    // Используем правильный формат для фьючерсных combined streams
    const url = `wss://fstream.binance.com/stream?streams=${streams.join('/')}`;

    this.logger.log(`WebSocket ${connectionIndex + 1}: подключение к ${limitedSymbols.length} фьючерсам`);

    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.logger.log(`WebSocket ${connectionIndex + 1}: подключен к фьючерсам (${limitedSymbols.length} пар)`);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.stream && message.data) {
          const klineData: BinanceKlineData = message.data;
          
          // Обрабатываем только закрытые свечи
          if (klineData.k && klineData.k.x) {
            const kline: KlineData = {
              symbol: klineData.k.s,
              openTime: klineData.k.t,
              closeTime: klineData.k.T,
              open: klineData.k.o,
              high: klineData.k.h,
              low: klineData.k.l,
              close: klineData.k.c,
              volume: klineData.k.v,
              timestamp: Date.now(),
            };

            onKline(kline);
          }
        }
      } catch (error) {
        this.logger.error(`WebSocket ${connectionIndex + 1} ошибка парсинга:`, error.message);
        onError?.(error);
      }
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket ${connectionIndex + 1} ошибка:`, error.message);
      onError?.(error);
    });

    ws.on('close', (code, reason) => {
      this.logger.warn(`WebSocket ${connectionIndex + 1} закрыт: ${code} - ${reason}`);
      
      // Переподключение
      setTimeout(() => {
        this.logger.log(`Переподключение WebSocket ${connectionIndex + 1}...`);
        this.createMultiStreamConnection(limitedSymbols, connectionIndex, wsUrl, interval, onKline, onError);
      }, 5000);
    });

    this.wsConnections.set(`connection_${connectionIndex}`, ws);
  }

  closeAllConnections(): void {
    this.logger.log('Закрытие всех WebSocket соединений...');
    this.wsConnections.forEach((ws, key) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wsConnections.clear();
  }
}
