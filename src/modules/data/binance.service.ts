import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as WebSocket from 'ws';
import { BinanceKlineData, KlineData, TradingPair } from '../../interfaces/kline.interface';

@Injectable()
export class BinanceService implements OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private wsConnections: Map<string, WebSocket> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 5000;

  constructor(private configService: ConfigService) {}

  async getTopTradingPairs(): Promise<TradingPair[]> {
    try {
      const baseUrl = this.configService.get<string>('binance.baseUrl');
      const limit = this.configService.get<number>('binance.topPairsLimit');

      // Получаем информацию о всех фьючерсных контрактах
      const exchangeInfoResponse = await axios.get(`${baseUrl}/fapi/v1/exchangeInfo`);
      const allSymbols = exchangeInfoResponse.data.symbols;

      // Получаем 24h статистику для всех фьючерсов
      const tickerResponse = await axios.get(`${baseUrl}/fapi/v1/ticker/24hr`);
      const tickerMap = new Map();
      tickerResponse.data.forEach((ticker: any) => {
        tickerMap.set(ticker.symbol, ticker);
      });

      // Фильтруем только активные USDT фьючерсы (perpetual contracts)
      let usdtFutures = allSymbols
        .filter((symbol: any) => 
          symbol.quoteAsset === 'USDT' &&
          symbol.status === 'TRADING' &&
          symbol.contractType === 'PERPETUAL' && // Только бессрочные контракты
          !symbol.symbol.includes('_') && // Исключаем quarterly контракты
          !symbol.symbol.endsWith('0329') && // Исключаем срочные контракты
          !symbol.symbol.endsWith('0626') &&
          !symbol.symbol.endsWith('0925') &&
          !symbol.symbol.endsWith('1231')
        )
        .map((symbol: any) => {
          const ticker = tickerMap.get(symbol.symbol);
          return {
            symbol: symbol.symbol,
            baseAsset: symbol.baseAsset,
            quoteAsset: symbol.quoteAsset,
            status: symbol.status,
            volume24h: ticker ? ticker.quoteVolume : '0',
            contractType: symbol.contractType,
          };
        })
        .filter((pair: any) => parseFloat(pair.volume24h) > 0) // Только пары с объемом
        .sort((a: any, b: any) => parseFloat(b.volume24h) - parseFloat(a.volume24h));

      // Если задан лимит, ограничиваем количество
      if (limit && limit > 0) {
        usdtFutures = usdtFutures.slice(0, limit);
      }

      this.logger.log(`Найдено ${usdtFutures.length} активных USDT фьючерсов`);
      
      // Выводим топ-20 для информации
      const top20 = usdtFutures.slice(0, 20).map((p: any) => p.symbol).join(', ');
      this.logger.log(`Топ-20 фьючерсов по объему: ${top20}`);
      
      return usdtFutures;
    } catch (error) {
      this.logger.error('Ошибка получения фьючерсных пар:', error.message);
      throw error;
    }
  }

  subscribeToKlines(
    symbols: string[], 
    onKline: (kline: KlineData) => void,
    onError?: (error: Error) => void
  ): void {
    const wsUrl = this.configService.get<string>('binance.wsUrl');
    const interval = this.configService.get<string>('binance.interval');

    if (!wsUrl || !interval) {
      throw new Error('WebSocket URL или интервал не настроены');
    }

    symbols.forEach(symbol => {
      this.connectToSymbol(symbol, wsUrl, interval, onKline, onError);
    });
  }

  private connectToSymbol(
    symbol: string,
    wsUrl: string,
    interval: string,
    onKline: (kline: KlineData) => void,
    onError?: (error: Error) => void
  ): void {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const url = `${wsUrl}/${streamName}`;

    this.logger.log(`Подключение к WebSocket: ${symbol}`);

    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.logger.log(`WebSocket подключен: ${symbol}`);
      this.reconnectAttempts.set(symbol, 0);
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const message: BinanceKlineData = JSON.parse(data.toString());
        
        // Обрабатываем только закрытые свечи
        if (message.k && message.k.x) {
          const kline: KlineData = {
            symbol: message.k.s,
            openTime: message.k.t,
            closeTime: message.k.T,
            open: message.k.o,
            high: message.k.h,
            low: message.k.l,
            close: message.k.c,
            volume: message.k.v,
            timestamp: Date.now(),
          };

          onKline(kline);
        }
      } catch (error) {
        this.logger.error(`Ошибка парсинга данных ${symbol}:`, error.message);
        onError?.(error);
      }
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket ошибка ${symbol}:`, error.message);
      onError?.(error);
    });

    ws.on('close', (code, reason) => {
      this.logger.warn(`WebSocket закрыт ${symbol}: ${code} - ${reason}`);
      this.handleReconnect(symbol, wsUrl, interval, onKline, onError);
    });

    this.wsConnections.set(symbol, ws);
  }

  private handleReconnect(
    symbol: string,
    wsUrl: string,
    interval: string,
    onKline: (kline: KlineData) => void,
    onError?: (error: Error) => void
  ): void {
    const attempts = this.reconnectAttempts.get(symbol) || 0;
    
    if (attempts < this.maxReconnectAttempts) {
      this.reconnectAttempts.set(symbol, attempts + 1);
      
      setTimeout(() => {
        this.logger.log(`Переподключение ${symbol} (попытка ${attempts + 1}/${this.maxReconnectAttempts})`);
        this.connectToSymbol(symbol, wsUrl, interval, onKline, onError);
      }, this.reconnectDelay * (attempts + 1));
    } else {
      this.logger.error(`Максимальное количество попыток переподключения превышено для ${symbol}`);
    }
  }

  onModuleDestroy() {
    this.logger.log('Закрытие всех WebSocket соединений...');
    this.wsConnections.forEach((ws, symbol) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wsConnections.clear();
  }
}
