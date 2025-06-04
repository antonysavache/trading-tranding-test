import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BinanceService } from './modules/data/binance.service';
import { DataBufferService } from './modules/data/data-buffer.service';
import { WebSocketManagerService } from './modules/data/websocket-manager.service';
import { PriceAnalysisService } from './modules/analysis/price-analysis.service';
import { VirtualTradingService } from './modules/trading/virtual-trading.service';
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
    private virtualTradingService: VirtualTradingService,
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
    this.logger.log(
      'Инициализация анализатора боковиков (5-минутные свечи)...',
    );

    // Получаем список всех торговых пар USDT
    const tradingPairs = await this.binanceService.getTopTradingPairs();
    this.symbols = tradingPairs.map((pair) => pair.symbol);

    this.logger.log(
      `Анализатор запущен: отслеживается ${this.symbols.length} символов`,
    );

    // Подписываемся на WebSocket потоки используя multi-stream подключения
    this.webSocketManagerService.subscribeToMultipleKlines(
      this.symbols,
      (kline: KlineData) => this.handleKlineData(kline),
      (error: Error) => this.handleKlineError(error),
    );

    this.isInitialized = true;
    this.logger.log('Анализатор боковиков успешно запущен');
  }

  private async handleKlineData(kline: KlineData): Promise<void> {
    try {
      // Добавляем свечу в буфер
      this.dataBufferService.addKline(kline);

      // НОВОЕ: Обрабатываем свечу для торговых позиций
      await this.priceAnalysisService.processKlineForTrading(kline);

      // Логируем каждую 20-ю свечу для отслеживания активности (реже для 5m)
      if (Math.random() < 0.05) {
        // 5% вероятность = примерно каждые 20 свечей
        this.logger.debug(
          `📊 Обработана 5m свеча: ${kline.symbol} по цене ${parseFloat(kline.close).toFixed(4)}`,
        );
      }

      // Проверяем, достаточно ли данных для качественного анализа (для 5-минутных свечей)
      if (!this.dataBufferService.hasEnoughData(kline.symbol, 20)) {
        // Нужно минимум 20 свечей (100 минут)
        return;
      }

      // Получаем свечи для анализа
      const klines = this.dataBufferService.getKlines(kline.symbol);

      // Анализируем на предмет боковиков
      const patterns = await this.priceAnalysisService.analyzeKlines(klines);

      // Логируем найденные боковики
      for (const pattern of patterns) {
        const direction =
          pattern.direction === 'high_to_low_to_high'
            ? 'возврат к максимуму'
            : 'возврат к минимуму';
        this.logger.log(
          `🔄 БОКОВИК НАЙДЕН: ${pattern.symbol} | ${direction} | Ширина: ${pattern.channelWidthPercent.toFixed(2)}%`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Ошибка обработки kline для ${kline.symbol}: ${error.message}`,
      );
    }
  }

  private handleKlineError(error: Error): void {
    this.logger.error('Ошибка WebSocket:', error.message);
  }

  private logActiveMovements(): void {
    if (!this.isInitialized) return;

    const activeMovements = this.priceAnalysisService.getActiveMovements();
    const bufferStats = this.dataBufferService.getBufferStats();
    const tradingStats = this.virtualTradingService.getTradingStats();

    // Логируем общую статистику включая торговлю
    this.logger.log(
      `📊 АКТИВНОСТЬ: Движений в процессе: ${activeMovements.size} | ` +
        `Активных позиций: ${tradingStats.activePosсitions} | ` +
        `Всего сделок: ${tradingStats.totalTrades} | ` +
        `Баланс: ${this.virtualTradingService.getVirtualBalance().toFixed(2)} USDT`,
    );

    // Если есть активные движения, показываем детали
    if (activeMovements.size > 0) {
      const details: string[] = [];
      for (const [symbol, movement] of activeMovements) {
        const pointsCount = movement.points.length;
        const lastPoint = movement.points[movement.points.length - 1];
        const status = movement.status;
        details.push(`${symbol}(${pointsCount}точек,${status})`);
      }

      // Показываем только первые 10, чтобы не спамить
      const displayDetails = details.slice(0, 10);
      if (details.length > 10) {
        displayDetails.push(`...и еще ${details.length - 10}`);
      }

      this.logger.log(`🔍 Активные движения: ${displayDetails.join(', ')}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  handleMinuteAnalysis(): void {
    if (this.isInitialized) {
      this.logActiveMovements();
      this.logTradingStatistics(); // Добавляем логирование торговой статистики каждую минуту
    }
  }

  // НОВОЕ: Логирование торговой статистики каждую минуту
  private logTradingStatistics(): void {
    const detailedStats = this.virtualTradingService.getDetailedTradingStats();

    if (detailedStats.totalTrades > 0 || detailedStats.activePosсitions > 0) {
      this.logger.log(
        `💰 ТОРГОВАЯ СТАТИСТИКА (1 мин) | ` +
          `Баланс: ${detailedStats.balance.toFixed(2)} USDT | ` +
          `Дневной PnL: ${detailedStats.dailyPnl >= 0 ? '+' : ''}${detailedStats.dailyPnl.toFixed(2)} USDT | ` +
          `Дневной ROI: ${detailedStats.dailyROI >= 0 ? '+' : ''}${detailedStats.dailyROI.toFixed(2)}% | ` +
          `Общий ROI: ${detailedStats.totalROI >= 0 ? '+' : ''}${detailedStats.totalROI.toFixed(2)}%`,
      );

      this.logger.log(
        `📊 ДЕТАЛИ | ` +
          `Сделок: ${detailedStats.totalTrades} | ` +
          `Активных: ${detailedStats.activePosсitions} | ` +
          `Винрейт: ${detailedStats.winRate.toFixed(1)}% | ` +
          `Комиссии: ${detailedStats.totalFees.toFixed(2)} USDT | ` +
          `Чистый PnL: ${detailedStats.netPnl >= 0 ? '+' : ''}${detailedStats.netPnl.toFixed(2)} USDT`,
      );
    } else {
      // Если еще нет сделок, показываем только баланс
      this.logger.log(
        `💰 ТОРГОВАЯ СТАТИСТИКА | ` +
          `Баланс: ${detailedStats.balance.toFixed(2)} USDT | ` +
          `Ожидание первых сделок...`,
      );
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  handleTradingStatistics(): void {
    if (this.isInitialized) {
      const detailedStats =
        this.virtualTradingService.getDetailedTradingStats();
      const activePositions = this.virtualTradingService.getActivePositions();

      if (detailedStats.totalTrades > 0) {
        this.logger.log(
          `📈 РАСШИРЕННАЯ СТАТИСТИКА (5 мин) | ` +
            `Всего сделок: ${detailedStats.totalTrades} | ` +
            `Выигрышных: ${detailedStats.winningTrades} | ` +
            `Проигрышных: ${detailedStats.losingTrades} | ` +
            `Винрейт: ${detailedStats.winRate.toFixed(1)}%`,
        );

        this.logger.log(
          `💵 ФИНАНСОВЫЕ ПОКАЗАТЕЛИ | ` +
            `Средний выигрыш: ${detailedStats.averageWin.toFixed(2)} USDT | ` +
            `Средний проигрыш: ${detailedStats.averageLoss.toFixed(2)} USDT | ` +
            `Профит-фактор: ${detailedStats.profitFactor.toFixed(2)} | ` +
            `Общие комиссии: ${detailedStats.totalFees.toFixed(2)} USDT`,
        );
      }



      // Показываем активные позиции если есть
      if (activePositions.length > 0) {
        const positionsList = activePositions
          .slice(0, 5) // Показываем только первые 5
          .map((pos) => `${pos.symbol}(${pos.side})`)
          .join(', ');

        this.logger.log(
          `🔥 АКТИВНЫЕ ПОЗИЦИИ (${activePositions.length}): ${positionsList}${
            activePositions.length > 5
              ? `...и еще ${activePositions.length - 5}`
              : ''
          }`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  handleHealthCheck(): void {
    if (this.isInitialized) {
      const activeMovements = this.priceAnalysisService.getActiveMovements();
      const balance = this.virtualTradingService.getVirtualBalance();

      this.logger.log(
        `💊 ЗДОРОВЬЕ: Движений: ${activeMovements.size} | Баланс: ${balance.toFixed(2)} USDT`,
      );
    }
  }

  getHello(): string {
    return 'Анализатор криптовалютных боковиков с торговлей запущен!';
  }

  getStatus(): any {
    const activeMovements = this.priceAnalysisService.getActiveMovements();
    const tradingStats = this.virtualTradingService.getTradingStats();
    const activePositions = this.virtualTradingService.getActivePositions();

    return {
      initialized: this.isInitialized,
      trackedSymbols: this.symbols.length,
      bufferStats: this.dataBufferService.getBufferStats(),
      activeMovements: activeMovements.size,
      trading: {
        enabled: true,
        balance: this.virtualTradingService.getVirtualBalance(),
        activePositions: activePositions.length,
        totalTrades: tradingStats.totalTrades,
        winRate: tradingStats.winRate,
        totalPnl: tradingStats.totalPnl,
      },
    };
  }

  // НОВОЕ: Метод для получения торговой статистики
  getTradingStats() {
    return this.virtualTradingService.getTradingStats();
  }

  // НОВОЕ: Метод для получения активных позиций
  getActivePositions() {
    return this.virtualTradingService.getActivePositions();
  }
}
