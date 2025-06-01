import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BinanceService } from './modules/data/binance.service';
import { DataBufferService } from './modules/data/data-buffer.service';
import { WebSocketManagerService } from './modules/data/websocket-manager.service';
import { PriceAnalysisService } from './modules/analysis/price-analysis.service';
import { TradingService } from './modules/trading/trading.service';
import { LoggingService } from './shared';
import { KlineData } from './interfaces/kline.interface';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);
  private isInitialized = false;
  private symbols: string[] = [];

  constructor(
    private binanceService: BinanceService,
    private dataBufferService: DataBufferService,
    private webSocketManagerService: WebSocketManagerService,
    private priceAnalysisService: PriceAnalysisService,
    private tradingService: TradingService,
    private loggingService: LoggingService,
  ) {}

  async onModuleInit() {
    try {
      await this.initializeApplication();
    } catch (error) {
      this.logger.error('Ошибка инициализации приложения:', error.message);
      throw error;
    }
  }

  private async initializeApplication(): Promise<void> {
    this.logger.log('Инициализация анализатора боковиков...');

    // Получаем список всех торговых пар USDT
    const tradingPairs = await this.binanceService.getTopTradingPairs();
    this.symbols = tradingPairs.map(pair => pair.symbol);

    // 🔥 ВАЖНО: Убеждаемся что BTCUSDT всегда включен для BTC тренд анализа
    if (!this.symbols.includes('BTCUSDT')) {
      this.symbols.unshift('BTCUSDT'); // Добавляем в начало списка
      this.logger.log('🔧 BTCUSDT добавлен для анализа BTC тренда');
    }

    // Логируем запуск
    this.loggingService.info(
      `Анализатор запущен: отслеживается ${this.symbols.length} символов`,
      'AppService'
    );

    // Подписываемся на WebSocket потоки используя multi-stream подключения
    this.webSocketManagerService.subscribeToMultipleKlines(
      this.symbols,
      (kline: KlineData) => this.handleKlineData(kline),
      (error: Error) => this.handleKlineError(error)
    );

    this.isInitialized = true;
    this.logger.log('Анализатор боковиков успешно запущен');
  }

  private async handleKlineData(kline: KlineData): Promise<void> {
    try {
      // Добавляем свечу в буфер
      this.dataBufferService.addKline(kline);

      // 🔥 ВАЖНО: Обновляем BTC тренд если это BTCUSDT
      if (kline.symbol === 'BTCUSDT') {
        this.tradingService['btcTrendService']?.updateBTCPrice(kline);
      }

      // Обновляем торговые позиции по текущей цене
      const currentPrice = parseFloat(kline.close);
      this.tradingService.updatePositions(kline.symbol, currentPrice);

      // Проверяем, достаточно ли данных для анализа (для минутных свечей нужно меньше)
      if (!this.dataBufferService.hasEnoughData(kline.symbol, 10)) {
        return;
      }

      // Получаем свечи для анализа
      const klines = this.dataBufferService.getKlines(kline.symbol);
      
      // 🔥 ОБНОВЛЕНО: Анализируем на предмет боковиков с Volume Profile (теперь async)
      const patterns = await this.priceAnalysisService.analyzeKlines(klines);
      
      // Логируем найденные боковики и создаем торговые сигналы
      for (const pattern of patterns) {
        // Простое логирование боковика
        const direction = pattern.direction === 'high_to_low_to_high' ? 'возврат к максимуму' : 'возврат к минимуму';
        this.logger.log(`🔄 БОКОВИК НАЙДЕН: ${pattern.symbol} | ${direction}`);
        
        // Логируем в Google Sheets
        this.loggingService.info(
          `Боковик найден: ${pattern.symbol} | ${direction}`,
          'AppService'
        );

        // Создаем торговый сигнал
        const signal = await this.tradingService.processSidewaysPattern(pattern, currentPrice);
        if (signal) {
          const position = this.tradingService.openPosition(signal);
          this.logger.log(`💼 СДЕЛКА ОТКРЫТА: ${position.symbol} ${position.direction}`);
        }
      }

    } catch (error) {
      this.logger.error(`Ошибка обработки kline для ${kline.symbol}: ${error.message}`);
      this.loggingService.error(`${kline.symbol}: ${error.message}`, 'AppService');
    }
  }

  private handleKlineError(error: Error): void {
    this.logger.error('Ошибка WebSocket:', error.message);
  }

  private logActiveMovements(): void {
    // Убрали частые логи активных движений - оставляем только боковики
    // Активные движения будут показываться только при нахождении боковика
  }

  private lastMovementLogTime = 0;

  private getLastMovementLogTime(): number {
    return this.lastMovementLogTime;
  }

  private setLastMovementLogTime(time: number): void {
    this.lastMovementLogTime = time;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  handleMinuteAnalysis(): void {
    if (this.isInitialized) {
      this.logActiveMovements();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  handleStatistics(): void {
    if (this.isInitialized) {
      // Простая статистика
      const tradingStats = this.tradingService.getTradingStats();
      if (tradingStats.closedTrades > 0) {
        this.logger.log(`📊 Статистика: Сделок ${tradingStats.closedTrades} | Win Rate: ${tradingStats.winRate.toFixed(1)}%`);
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  handleHealthCheck(): void {
    if (this.isInitialized) {
      const activeMovements = this.priceAnalysisService.getActiveMovements();
      
      // Только важная информация без спама
      if (activeMovements.size > 0) {
        this.logger.log(`Активных движений: ${activeMovements.size}`);
      }
    }
  }

  getHello(): string {
    return 'Анализатор криптовалютных боковиков запущен!';
  }

  getStatus(): any {
    const tradingStats = this.tradingService.getTradingStats();
    const openPositions = this.tradingService.getOpenPositions();
    const btcTrendAnalysis = this.tradingService['btcTrendService']?.getBTCTrendAnalysis();
    
    return {
      initialized: this.isInitialized,
      trackedSymbols: this.symbols.length,
      btcIncluded: this.symbols.includes('BTCUSDT'),
      bufferStats: this.dataBufferService.getBufferStats(),
      activeMovements: this.priceAnalysisService.getActiveMovements().size,
      sidewaysFound: 0, // Пока убираем, так как нет AnalysisLoggingService
      btcTrend: btcTrendAnalysis ? {
        trend: btcTrendAnalysis.trend,
        ready: this.tradingService['btcTrendService']?.isReady() || false,
        ema20: btcTrendAnalysis.ema20?.toFixed(2),
        ema50: btcTrendAnalysis.ema50?.toFixed(2),
      } : {
        trend: 'NOT_INITIALIZED',
        ready: false,
      },
      trading: {
        stats: tradingStats,
        openPositions: openPositions.length,
        recentPositions: openPositions.slice(-5).map(pos => ({
          symbol: pos.symbol,
          direction: pos.direction,
          pnl: pos.unrealizedPnl.toFixed(2) + '%',
          entryPrice: pos.entryPrice,
          currentPrice: pos.currentPrice,
          // 🆕 Добавляем информацию о подтверждениях
          confirmation: pos.confirmation ? {
            btcTrend: pos.confirmation.btcTrend,
            volumeProfile: pos.confirmation.volumeProfile,
            overall: pos.confirmation.overall,
            icon: pos.confirmation.overall ? '🟢' : '🟡',
            status: pos.confirmation.overall ? 'ПОЛНОЕ' : 'ЧАСТИЧНОЕ',
          } : null,
        })),
      },
    };
  }
}
