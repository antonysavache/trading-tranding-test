import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {
    TradingPosition,
    TradingSignal,
    TradingStats,
    TradingConfig
} from '../../interfaces/trading.interface';
import {TrendPattern} from '../../interfaces/analysis.interface';
import {BTCTrendService} from './btc-trend.service';
import {v4 as uuidv4} from 'uuid';

@Injectable()
export class TrendTradingService {
    private readonly logger = new Logger(TrendTradingService.name);
    private readonly config: TradingConfig;

    // Активные позиции
    private readonly openPositions: Map<string, TradingPosition> = new Map();

    // История закрытых позиций
    private readonly closedPositions: TradingPosition[] = [];

    // Статистика
    private stats: TradingStats = {
        totalTrades: 0,
        openTrades: 0,
        closedTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        winRate: 0,
        totalPnl: 0,
        averagePnl: 0,
        maxWin: 0,
        maxLoss: 0,
    };

    constructor(
        private configService: ConfigService,
        private btcTrendService: BTCTrendService,
    ) {
        this.config = {
            enabled: this.configService.get<boolean>('trading.enabled', true),
            takeProfitPercent: this.configService.get<number>('trading.takeProfitPercent', 3.0), // Фоллбэк
            stopLossPercent: this.configService.get<number>('trading.stopLossPercent', 2.0), // Фоллбэк
            maxPositionsPerSymbol: this.configService.get<number>('trading.maxPositionsPerSymbol', 2),
            maxTotalPositions: this.configService.get<number>('trading.maxTotalPositions', 20),
            
            // 🆕 НАСТРОЙКИ ДЛЯ АДАПТИВНОГО TP/SL
            adaptive: {
                enabled: this.configService.get<boolean>('trading.adaptive.enabled', true),
                minStopLossPercent: this.configService.get<number>('trading.adaptive.minStopLossPercent', 0.5),
                maxStopLossPercent: this.configService.get<number>('trading.adaptive.maxStopLossPercent', 5.0),
                minTakeProfitPercent: this.configService.get<number>('trading.adaptive.minTakeProfitPercent', 1.0),
                maxTakeProfitPercent: this.configService.get<number>('trading.adaptive.maxTakeProfitPercent', 15.0),
                stopLossChannelFraction: this.configService.get<number>('trading.adaptive.stopLossChannelFraction', 0.3),
                takeProfitChannelFraction: this.configService.get<number>('trading.adaptive.takeProfitChannelFraction', 0.8),
                minRiskRewardRatio: this.configService.get<number>('trading.adaptive.minRiskRewardRatio', 1.5),
            },
        };

        const mode = this.config.adaptive?.enabled ? 'АДАПТИВНЫЙ (на основе канала)' : 'ФИКСИРОВАННЫЙ';
        this.logger.log(`Trend Trading Service инициализирован | Режим: ${mode}`);
        
        if (this.config.adaptive?.enabled) {
            this.logger.log(`📊 Адаптивные настройки: SL=${this.config.adaptive.stopLossChannelFraction*100}% от канала, TP=${this.config.adaptive.takeProfitChannelFraction*100}% от канала, R/R≥1:${this.config.adaptive.minRiskRewardRatio}`);
        } else {
            this.logger.log(`📊 Фиксированные настройки: TP=${this.config.takeProfitPercent}%, SL=${this.config.stopLossPercent}%`);
        }
    }

    /**
     * 🎯 КЛЮЧЕВОЙ МЕТОД: Создает торговые сигналы на основе найденного тренда
     */
    async processTrendPattern(pattern: TrendPattern, currentPrice: number): Promise<TradingSignal[]> {
        if (!this.config.enabled) {
            return [];
        }

        const signals: TradingSignal[] = [];

        // 🎯 ПРИМЕНЯЕМ BTC ФИЛЬТР
        const btcTrendAnalysis = this.btcTrendService.getBTCTrendAnalysis();
        let btcPassed = true; // По умолчанию разрешаем если BTC анализ не готов

        if (btcTrendAnalysis) {
            // BTC фильтр применяется ко всем направлениям
            btcPassed = true; // Пока что разрешаем все
        }

        if (!btcPassed) {
            this.logger.log(`❌ ТРЕНД ОТКЛОНЕН ${pattern.symbol}: BTC фильтр не прошел`);
            return [];
        }

        // 🎯 СОЗДАЕМ СИГНАЛЫ ДЛЯ LONG И SHORT УРОВНЕЙ

        // 1. LONG сигнал
        if (this.shouldCreateLongSignal(pattern, currentPrice)) {
            const longSignal = this.createLongSignal(pattern, currentPrice);
            if (longSignal) {
                signals.push(longSignal);
            }
        }

        // 2. SHORT сигнал
        if (this.shouldCreateShortSignal(pattern, currentPrice)) {
            const shortSignal = this.createShortSignal(pattern, currentPrice);
            if (shortSignal) {
                signals.push(shortSignal);
            }
        }

        return signals;
    }

    /**
     * 🎯 Проверяет, нужно ли создать LONG сигнал
     */
    private shouldCreateLongSignal(pattern: TrendPattern, currentPrice: number): boolean {
        const longLevel = pattern.nextLevels.long;
        const tolerance = longLevel * 0.001; // 0.1% толерантность

        // Проверяем что цена достигла уровня LONG
        const priceAtLevel = Math.abs(currentPrice - longLevel) <= tolerance;

        if (priceAtLevel) {
            this.logger.debug(`${pattern.symbol}: Цена ${currentPrice.toFixed(6)} достигла LONG уровня ${longLevel.toFixed(6)}`);
        }

        return priceAtLevel;
    }

    /**
     * 🎯 Проверяет, нужно ли создать SHORT сигнал
     */
    private shouldCreateShortSignal(pattern: TrendPattern, currentPrice: number): boolean {
        const shortLevel = pattern.nextLevels.short;
        const tolerance = shortLevel * 0.001; // 0.1% толерантность

        // Проверяем что цена достигла уровня SHORT
        const priceAtLevel = Math.abs(currentPrice - shortLevel) <= tolerance;

        if (priceAtLevel) {
            this.logger.debug(`${pattern.symbol}: Цена ${currentPrice.toFixed(6)} достигла SHORT уровня ${shortLevel.toFixed(6)}`);
        }

        return priceAtLevel;
    }

    /**
     * 🎯 Создает LONG сигнал с адаптивными TP/SL на основе ширины канала
     */
    private createLongSignal(pattern: TrendPattern, currentPrice: number): TradingSignal | null {
        if (!this.canOpenPosition(pattern.symbol)) {
            this.logger.debug(`${pattern.symbol}: Превышен лимит позиций для LONG`);
            return null;
        }

        // 🎯 АДАПТИВНЫЙ РАСЧЕТ TP/SL НА ОСНОВЕ ШИРИНЫ КАНАЛА
        const channelCalculation = this.calculateAdaptiveTPSL(pattern, currentPrice, 'LONG');

        const signal: TradingSignal = {
            symbol: pattern.symbol,
            direction: 'LONG',
            entryPrice: currentPrice,
            timestamp: Date.now(),
            reason: `Тренд ${pattern.trendDirection} | LONG на уровне ${pattern.nextLevels.long.toFixed(6)} | Канал: ${channelCalculation.channelWidthPercent.toFixed(2)}% | R/R: 1:${channelCalculation.riskRewardRatio.toFixed(1)}`,
            takeProfitPrice: Number(channelCalculation.takeProfitPrice.toFixed(8)),
            stopLossPrice: Number(channelCalculation.stopLossPrice.toFixed(8)),
            confirmation: {
                btcTrend: true,
                volumeProfile: true, // Не используем VP фильтр для тренд-стратегии
                overall: true,
            },
        };

        this.logger.log(`🟢 LONG СИГНАЛ [${pattern.trendDirection}] ${pattern.symbol} на уровне ${pattern.nextLevels.long.toFixed(6)}`);
        this.logger.log(`📊 Канал: ${channelCalculation.channelWidthPercent.toFixed(2)}% | TP: ${this.formatPrice(channelCalculation.takeProfitPrice)} | SL: ${this.formatPrice(channelCalculation.stopLossPrice)} | R/R: 1:${channelCalculation.riskRewardRatio.toFixed(1)}`);

        return signal;
    }

    /**
     * 🎯 Создает SHORT сигнал с адаптивными TP/SL на основе ширины канала
     */
    private createShortSignal(pattern: TrendPattern, currentPrice: number): TradingSignal | null {
        if (!this.canOpenPosition(pattern.symbol)) {
            this.logger.debug(`${pattern.symbol}: Превышен лимит позиций для SHORT`);
            return null;
        }

        // 🎯 АДАПТИВНЫЙ РАСЧЕТ TP/SL НА ОСНОВЕ ШИРИНЫ КАНАЛА
        const channelCalculation = this.calculateAdaptiveTPSL(pattern, currentPrice, 'SHORT');

        const signal: TradingSignal = {
            symbol: pattern.symbol,
            direction: 'SHORT',
            entryPrice: currentPrice,
            timestamp: Date.now(),
            reason: `Тренд ${pattern.trendDirection} | SHORT на уровне ${pattern.nextLevels.short.toFixed(6)} | Канал: ${channelCalculation.channelWidthPercent.toFixed(2)}% | R/R: 1:${channelCalculation.riskRewardRatio.toFixed(1)}`,
            takeProfitPrice: Number(channelCalculation.takeProfitPrice.toFixed(8)),
            stopLossPrice: Number(channelCalculation.stopLossPrice.toFixed(8)),
            confirmation: {
                btcTrend: true,
                volumeProfile: true,
                overall: true,
            },
        };

        this.logger.log(`🔴 SHORT СИГНАЛ [${pattern.trendDirection}] ${pattern.symbol} на уровне ${pattern.nextLevels.short.toFixed(6)}`);
        this.logger.log(`📊 Канал: ${channelCalculation.channelWidthPercent.toFixed(2)}% | TP: ${this.formatPrice(channelCalculation.takeProfitPrice)} | SL: ${this.formatPrice(channelCalculation.stopLossPrice)} | R/R: 1:${channelCalculation.riskRewardRatio.toFixed(1)}`);

        return signal;
    }

    /**
     * 🎯 КЛЮЧЕВОЙ МЕТОД: Рассчитывает адаптивные TP/SL на основе ширины канала
     */
    private calculateAdaptiveTPSL(pattern: TrendPattern, entryPrice: number, direction: 'LONG' | 'SHORT'): {
        takeProfitPrice: number;
        stopLossPrice: number;
        channelWidthPercent: number;
        riskRewardRatio: number;
        method: string;
    } {
        // 🎯 ВЫЧИСЛЯЕМ ШИРИНУ КАНАЛА между point1, point2, point3
        const channelWidth = this.calculateChannelWidth(pattern);
        const channelWidthPercent = (channelWidth / entryPrice) * 100;

        // 🎯 НАСТРОЙКИ ДЛЯ АДАПТИВНОГО РАСЧЕТА
        const settings = {
            // Минимальные и максимальные размеры TP/SL
            minStopLossPercent: 0.5,   // Минимум 0.5%
            maxStopLossPercent: 5.0,   // Максимум 5%
            minTakeProfitPercent: 1.0, // Минимум 1%
            maxTakeProfitPercent: 15.0, // Максимум 15%
            
            // Коэффициенты для расчета от ширины канала
            stopLossChannelFraction: 0.3,  // SL = 30% от ширины канала
            takeProfitChannelFraction: 0.8, // TP = 80% от ширины канала
            
            // Минимальное соотношение Risk/Reward
            minRiskRewardRatio: 1.5,
        };

        // 🎯 РАССЧИТЫВАЕМ СТОП-ЛОСС (% от ширины канала)
        let stopLossPercent = channelWidthPercent * settings.stopLossChannelFraction;
        stopLossPercent = Math.max(settings.minStopLossPercent, 
                          Math.min(settings.maxStopLossPercent, stopLossPercent));

        // 🎯 РАССЧИТЫВАЕМ ТЕЙК-ПРОФИТ (% от ширины канала)
        let takeProfitPercent = channelWidthPercent * settings.takeProfitChannelFraction;
        takeProfitPercent = Math.max(settings.minTakeProfitPercent, 
                            Math.min(settings.maxTakeProfitPercent, takeProfitPercent));

        // 🎯 ПРОВЕРЯЕМ И КОРРЕКТИРУЕМ RISK/REWARD RATIO
        const currentRiskReward = takeProfitPercent / stopLossPercent;
        if (currentRiskReward < settings.minRiskRewardRatio) {
            // Увеличиваем TP для достижения минимального R/R
            takeProfitPercent = stopLossPercent * settings.minRiskRewardRatio;
            takeProfitPercent = Math.min(settings.maxTakeProfitPercent, takeProfitPercent);
        }

        // 🎯 ВЫЧИСЛЯЕМ ЦЕНЫ TP/SL
        let takeProfitPrice: number;
        let stopLossPrice: number;

        if (direction === 'LONG') {
            takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100);
            stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
        } else { // SHORT
            takeProfitPrice = entryPrice * (1 - takeProfitPercent / 100);
            stopLossPrice = entryPrice * (1 + stopLossPercent / 100);
        }

        const finalRiskReward = takeProfitPercent / stopLossPercent;

        return {
            takeProfitPrice,
            stopLossPrice,
            channelWidthPercent,
            riskRewardRatio: finalRiskReward,
            method: `Канал: ${channelWidthPercent.toFixed(2)}% → SL: ${stopLossPercent.toFixed(2)}% | TP: ${takeProfitPercent.toFixed(2)}%`
        };
    }

    /**
     * 🎯 Вычисляет ширину канала между тремя точками тренда
     */
    private calculateChannelWidth(pattern: TrendPattern): number {
        const prices = [pattern.point1.price, pattern.point2.price, pattern.point3.price];
        const maxPrice = Math.max(...prices);
        const minPrice = Math.min(...prices);
        
        // Ширина канала = разница между максимальной и минимальной ценой
        return maxPrice - minPrice;
    }
    openPosition(signal: TradingSignal): TradingPosition {
        const position: TradingPosition = {
            id: uuidv4(),
            symbol: signal.symbol,
            direction: signal.direction,
            entryPrice: signal.entryPrice,
            entryTime: signal.timestamp,
            currentPrice: signal.entryPrice,
            takeProfitPrice: signal.takeProfitPrice,
            stopLossPrice: signal.stopLossPrice,
            status: 'OPEN',
            unrealizedPnl: 0,
            triggerReason: signal.reason,
            confirmation: signal.confirmation,
        };

        this.openPositions.set(position.id, position);
        this.stats.totalTrades++;
        this.stats.openTrades++;

        const trendIcon = position.direction === 'LONG' ? '📈' : '📉';
        this.logger.log(`🔥 ${trendIcon} ТРЕНД ПОЗИЦИЯ ОТКРЫТА [${position.direction}] ${position.symbol} по ${this.formatPrice(position.entryPrice)}`);
        this.logger.log(`📊 TP: ${this.formatPrice(position.takeProfitPrice)} | SL: ${this.formatPrice(position.stopLossPrice)}`);

        return position;
    }

    /**
     * Обновляет все открытые позиции текущими ценами
     */
    updatePositions(symbol: string, currentPrice: number): void {
        const symbolPositions = Array.from(this.openPositions.values())
            .filter(pos => pos.symbol === symbol && pos.status === 'OPEN');

        for (const position of symbolPositions) {
            this.updatePosition(position, currentPrice);
        }
    }

    /**
     * Обновляет конкретную позицию
     */
    private updatePosition(position: TradingPosition, currentPrice: number): void {
        const oldPrice = position.currentPrice;
        position.currentPrice = currentPrice;

        // Рассчитываем PnL
        if (position.direction === 'LONG') {
            position.unrealizedPnl = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
            position.unrealizedPnl = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
        }

        // Проверяем условия закрытия
        let shouldClose = false;
        let closeReason = '';

        // Проверка тейк-профита
        if (position.direction === 'LONG' && currentPrice >= position.takeProfitPrice) {
            shouldClose = true;
            closeReason = 'Take Profit достигнут';
            position.status = 'CLOSED_TP';
        } else if (position.direction === 'SHORT' && currentPrice <= position.takeProfitPrice) {
            shouldClose = true;
            closeReason = 'Take Profit достигнут';
            position.status = 'CLOSED_TP';
        }

        // Проверка стоп-лосса
        if (position.direction === 'LONG' && currentPrice <= position.stopLossPrice) {
            shouldClose = true;
            closeReason = 'Stop Loss сработал';
            position.status = 'CLOSED_SL';
        } else if (position.direction === 'SHORT' && currentPrice >= position.stopLossPrice) {
            shouldClose = true;
            closeReason = 'Stop Loss сработал';
            position.status = 'CLOSED_SL';
        }

        // Закрываем позицию если нужно
        if (shouldClose) {
            this.closePosition(position, currentPrice, closeReason);
        }
    }

    /**
     * Закрывает позицию
     */
    private closePosition(position: TradingPosition, closePrice: number, reason: string): void {
        position.closedPrice = closePrice;
        position.closedTime = Date.now();
        position.closeReason = reason;
        position.realizedPnl = position.unrealizedPnl;

        // Обновляем статистику
        this.stats.openTrades--;
        this.stats.closedTrades++;

        if (position.realizedPnl > 0) {
            this.stats.winTrades++;
            if (position.realizedPnl > this.stats.maxWin) {
                this.stats.maxWin = position.realizedPnl;
            }
        } else {
            this.stats.lossTrades++;
            if (position.realizedPnl < this.stats.maxLoss) {
                this.stats.maxLoss = position.realizedPnl;
            }
        }

        this.stats.totalPnl += position.realizedPnl;
        this.stats.winRate = (this.stats.winTrades / this.stats.closedTrades) * 100;
        this.stats.averagePnl = this.stats.totalPnl / this.stats.closedTrades;

        // Переносим в историю
        this.closedPositions.push({...position});
        this.openPositions.delete(position.id);

        const emoji = position.status === 'CLOSED_TP' ? '✅' : '❌';
        const pnlColor = position.realizedPnl > 0 ? '+' : '';

        this.logger.log(`${emoji} ТРЕНД ПОЗИЦИЯ ЗАКРЫТА [${position.direction}] ${position.symbol} | ${pnlColor}${position.realizedPnl.toFixed(2)}% | ${reason}`);
        this.logger.log(`📈 Вход: ${this.formatPrice(position.entryPrice)} → Выход: ${this.formatPrice(closePrice)}`);
    }

    /**
     * Проверяет, можно ли открыть позицию для символа
     */
    private canOpenPosition(symbol: string): boolean {
        const symbolPositions = Array.from(this.openPositions.values())
            .filter(pos => pos.symbol === symbol).length;

        return symbolPositions < this.config.maxPositionsPerSymbol;
    }

    /**
     * Возвращает статистику торговли
     */
    getTradingStats(): TradingStats {
        return {...this.stats};
    }

    /**
     * Возвращает все открытые позиции
     */
    getOpenPositions(): TradingPosition[] {
        return Array.from(this.openPositions.values());
    }

    /**
     * Возвращает историю закрытых позиций
     */
    getClosedPositions(): TradingPosition[] {
        return [...this.closedPositions];
    }

    /**
     * Форматирует цену для отображения
     */
    private formatPrice(price: number): string {
        if (price >= 1000) {
            return price.toFixed(2);
        } else if (price >= 1) {
            return price.toFixed(4);
        } else if (price >= 0.01) {
            return price.toFixed(6);
        } else {
            return price.toFixed(8);
        }
    }

    /**
     * Логирует текущую статистику
     */
    logTradingStats(): void {
        this.logger.log(`📊 ТРЕНД СТАТИСТИКА:`);
        this.logger.log(`   Всего сделок: ${this.stats.totalTrades} | Открыто: ${this.stats.openTrades} | Закрыто: ${this.stats.closedTrades}`);
        if (this.stats.closedTrades > 0) {
            this.logger.log(`   Выигрышных: ${this.stats.winTrades} | Проигрышных: ${this.stats.lossTrades} | Win Rate: ${this.stats.winRate.toFixed(1)}%`);
            this.logger.log(`   Общий PnL: ${this.stats.totalPnl.toFixed(2)}% | Средний PnL: ${this.stats.averagePnl.toFixed(2)}%`);
            this.logger.log(`   Лучшая сделка: +${this.stats.maxWin.toFixed(2)}% | Худшая: ${this.stats.maxLoss.toFixed(2)}%`);
        }
    }
}
