import {Injectable, Logger, OnModuleInit} from '@nestjs/common';
import {Cron, CronExpression} from '@nestjs/schedule';
import {BinanceService} from './modules/data/binance.service';
import {DataBufferService} from './modules/data/data-buffer.service';
import {WebSocketManagerService} from './modules/data/websocket-manager.service';
import {PriceAnalysisService} from './modules/analysis/price-analysis.service';
import {TrendAnalysisService} from './modules/analysis/trend-analysis.service';
import {TradingService} from './modules/trading/trading.service';
import {TrendTradingService} from './modules/trading/trend-trading.service';
import {LoggingService} from './shared';
import {KlineData} from './interfaces/kline.interface';

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
        private trendAnalysisService: TrendAnalysisService,
        private tradingService: TradingService,
        private trendTradingService: TrendTradingService,
        private loggingService: LoggingService,
    ) {
    }

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
                this.trendTradingService['btcTrendService']?.updateBTCPrice(kline);
            }

            // Обновляем торговые позиции по текущей цене
            const currentPrice = parseFloat(kline.close);
            this.trendTradingService.updatePositions(kline.symbol, currentPrice);

            // Проверяем, достаточно ли данных для анализа (для минутных свечей нужно меньше)
            if (!this.dataBufferService.hasEnoughData(kline.symbol, 10)) {
                return;
            }

            // Получаем свечи для анализа
            const klines = this.dataBufferService.getKlines(kline.symbol);

            // 🎯 НОВЫЙ АНАЛИЗ: Анализируем на предмет ТРЕНДОВ
            const trendPatterns = this.trendAnalysisService.analyzeKlines(klines);

            // Обрабатываем найденные тренды
            for (const trendPattern of trendPatterns) {
                this.logger.log(`📈 ТРЕНД НАЙДЕН: ${trendPattern.symbol} | ${trendPattern.trendDirection}`);

                // Логируем в Google Sheets
                this.loggingService.info(
                    `Тренд найден: ${trendPattern.symbol} | ${trendPattern.trendDirection} | Ступень: ${trendPattern.stepPercentage.toFixed(2)}%`,
                    'AppService'
                );

                // Создаем торговые сигналы для тренда
                const trendSignals = await this.trendTradingService.processTrendPattern(trendPattern, currentPrice);

                for (const signal of trendSignals) {
                    const position = this.trendTradingService.openPosition(signal);
                    this.logger.log(`💼 ТРЕНД СДЕЛКА ОТКРЫТА: ${position.symbol} ${position.direction}`);
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
            // Статистика тренд-торговли
            const trendStats = this.trendTradingService.getTradingStats();
            if (trendStats.closedTrades > 0) {
                this.logger.log(`📊 ТРЕНД Статистика: Сделок ${trendStats.closedTrades} | Win Rate: ${trendStats.winRate.toFixed(1)}%`);
            }
        }
    }

    @Cron(CronExpression.EVERY_10_MINUTES)
    handleHealthCheck(): void {
        if (this.isInitialized) {
            const activeTrendMovements = this.trendAnalysisService.getActiveTrendMovements();

            // Только важная информация без спама
            if (activeTrendMovements.size > 0) {
                this.logger.log(`Активных трендовых движений: ${activeTrendMovements.size}`);
            }
        }
    }

    getHello(): string {
        return '🎯 ТРЕНД-СКРИНЕР криптовалют запущен!';
    }

    getStatus(): any {
        const trendStats = this.trendTradingService.getTradingStats();
        const openPositions = this.trendTradingService.getOpenPositions();
        const btcTrendAnalysis = this.trendTradingService['btcTrendService']?.getBTCTrendAnalysis();

        return {
            initialized: this.isInitialized,
            strategy: 'TREND_TRADING',
            trackedSymbols: this.symbols.length,
            btcIncluded: this.symbols.includes('BTCUSDT'),
            bufferStats: this.dataBufferService.getBufferStats(),
            activeTrendMovements: this.trendAnalysisService.getActiveTrendMovements().size,
            btcTrend: btcTrendAnalysis ? {
                trend: btcTrendAnalysis.trend,
                ready: this.trendTradingService['btcTrendService']?.isReady() || false,
                ema20: btcTrendAnalysis.ema20?.toFixed(2),
                ema50: btcTrendAnalysis.ema50?.toFixed(2),
            } : {
                trend: 'NOT_INITIALIZED',
                ready: false,
            },
            trendTrading: {
                stats: trendStats,
                openPositions: openPositions.length,
                recentPositions: openPositions.slice(-5).map(pos => ({
                    symbol: pos.symbol,
                    direction: pos.direction,
                    pnl: pos.unrealizedPnl.toFixed(2) + '%',
                    entryPrice: pos.entryPrice,
                    currentPrice: pos.currentPrice,
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
