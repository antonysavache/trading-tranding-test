import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {
    TradingPosition,
    TradingSignal,
    TradingStats,
    TradingConfig
} from '../../interfaces/trading.interface';
import {SidewaysPattern} from '../../interfaces/analysis.interface';
import {BTCTrendService} from './btc-trend.service';
import {OrderBookAnalysisService} from '../analysis/orderbook-analysis.service';
import {SignalService, TradingSignal as GoogleSheetsSignal} from '../../shared';
import {v4 as uuidv4} from 'uuid';

@Injectable()
export class TradingService {
    private readonly logger = new Logger(TradingService.name);
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
        private orderBookService: OrderBookAnalysisService,
        private signalService: SignalService,
    ) {
        this.config = {
            enabled: this.configService.get<boolean>('trading.enabled', true),
            takeProfitPercent: this.configService.get<number>('trading.takeProfitPercent', 2.0), // 2%
            stopLossPercent: this.configService.get<number>('trading.stopLossPercent', 2.0), // 2% (равно ТП)
            maxPositionsPerSymbol: this.configService.get<number>('trading.maxPositionsPerSymbol', 1),
            maxTotalPositions: this.configService.get<number>('trading.maxTotalPositions', 10),
        };

        this.logger.log(`Trading Service инициализирован: TP=${this.config.takeProfitPercent}%, SL=${this.config.stopLossPercent}%`);
    }

    /**
     * Создает торговый сигнал на основе найденного бокового движения
     * 🆕 НОВАЯ ЛОГИКА: Применяем фильтры ПОСЛЕ нахождения боковика
     */
    async processSidewaysPattern(pattern: SidewaysPattern, currentPrice: number): Promise<TradingSignal | null> {
        if (!this.config.enabled) {
            return null;
        }

        // Проверяем лимиты позиций
        if (!this.canOpenPosition(pattern.symbol)) {
            this.logger.debug(`${pattern.symbol}: Превышен лимит позиций`);
            return null;
        }

        // Определяем направление сделки на основе паттерна
        let direction: 'LONG' | 'SHORT';
        let reason: string;

        if (pattern.direction === 'low_to_high_to_low') {
            direction = 'LONG';
            reason = `Боковик завершен возвратом к низу (${pattern.startPrice.toFixed(6)} → ${pattern.middlePrice.toFixed(6)} → ${currentPrice.toFixed(6)})`;
        } else {
            direction = 'SHORT';
            reason = `Боковик завершен возвратом к верху (${pattern.startPrice.toFixed(6)} → ${pattern.middlePrice.toFixed(6)} → ${currentPrice.toFixed(6)})`;
        }

        // 🔥 ПРОВЕРЯЕМ ПРОТИВОПОЛОЖНУЮ ПОЗИЦИЮ
        const existingPosition = this.getPositionBySymbol(pattern.symbol);
        if (existingPosition && existingPosition.direction !== direction) {
            this.closePositionByReversal(existingPosition, currentPrice, `Смена тренда: ${existingPosition.direction} → ${direction}`);
            this.logger.log(
                `🔄 СМЕНА НАПРАВЛЕНИЯ [${existingPosition.direction} → ${direction}] ${pattern.symbol} | ` +
                `Старая позиция закрыта по цене ${currentPrice.toFixed(6)}`
            );
        }

        // 🆕 ПРИМЕНЯЕМ ФИЛЬТРЫ: VP и BTC
        const confirmation = {
            btcTrend: false,       // Будет определен реально
            volumeProfile: true,   // По умолчанию true  
            overall: false
        };

        const filterResults: string[] = [];

        // 1. BTC тренд фильтр - проверяем реально по направлению
        const btcTrendAnalysis = this.btcTrendService.getBTCTrendAnalysis();
        let btcPassed = false;

        if (btcTrendAnalysis) {
            // Проверяем соответствие направления сделки и BTC тренда
            btcPassed = this.btcTrendService.isDirectionAllowed(direction);
            confirmation.btcTrend = btcPassed;

            if (btcPassed) {
                filterResults.push(`BTC: ✅ ${btcTrendAnalysis.trend}`);
            } else {
                filterResults.push(`BTC: ❌ ${btcTrendAnalysis.trend} (${direction} не разрешен)`);
            }
        } else {
            // Если BTC анализ еще не готов - разрешаем
            btcPassed = true;
            confirmation.btcTrend = true;
            filterResults.push(`BTC: ✅ не инициализирован (разрешено)`);
        }

        // 2. Volume Profile фильтр - проверяем реально
        let vpPassed = false;
        try {
            vpPassed = await this.validateWithVolumeProfile(pattern);
            confirmation.volumeProfile = vpPassed;

            if (vpPassed) {
                filterResults.push(`VP: ✅`);
            } else {
                filterResults.push(`VP: ❌`);
            }
        } catch (error) {
            confirmation.volumeProfile = false;
            filterResults.push(`VP: ⚠️ ошибка`);
        }

        // 3. Проверяем Order Book для подтверждения (простое true/false)
        let orderBookConfirmed = false;
        try {
            const orderBookAnalysis = await this.orderBookService.getOrderBookAnalysis(pattern.symbol);
            orderBookConfirmed = this.orderBookService.isDirectionSupported(direction, orderBookAnalysis);

            if (orderBookConfirmed) {
                filterResults.push(`OrderBook: ✅`);
            } else {
                filterResults.push(`OrderBook: ❌`);
            }
        } catch (error) {
            filterResults.push(`OrderBook: ⚠️ недоступен`);
            orderBookConfirmed = false;
        }

        // 4. Общее подтверждение - только order book определяет
        confirmation.overall = orderBookConfirmed;

        // 🆕 ЛОГИРУЕМ РЕЗУЛЬТАТ ПРОВЕРКИ ФИЛЬТРОВ
        this.logger.log(`🔍 ПРОВЕРКА ФИЛЬТРОВ [${direction}] ${pattern.symbol}: ${filterResults.join(' | ')}`);

        // 🆕 ПРОВЕРЯЕМ КРИТИЧНЫЕ ФИЛЬТРЫ (BTC и VP)
        if (!btcPassed) {
            this.logger.log(`❌ БОКОВИК ОТКЛОНЕН ${pattern.symbol}: BTC фильтр не прошел (${direction} при ${btcTrendAnalysis?.trend || 'UNKNOWN'} тренде)`);
            return null; // Отклоняем сигнал
        }

        if (!vpPassed) {
            this.logger.log(`❌ БОКОВИК ОТКЛОНЕН ${pattern.symbol}: VP фильтр не прошел`);
            return null; // Отклоняем сигнал
        }

        this.logger.log(`✅ БОКОВИК ПРИНЯТ ${pattern.symbol}: все критичные фильтры пройдены`);

        // Рассчитываем уровни TP и SL
        const takeProfitPrice = direction === 'LONG'
            ? currentPrice * (1 + this.config.takeProfitPercent / 100)
            : currentPrice * (1 - this.config.takeProfitPercent / 100);

        const stopLossPrice = direction === 'LONG'
            ? currentPrice * (1 - this.config.stopLossPercent / 100)
            : currentPrice * (1 + this.config.stopLossPercent / 100);

        const signal: TradingSignal = {
            symbol: pattern.symbol,
            direction,
            entryPrice: currentPrice,
            timestamp: Date.now(),
            reason: `${reason} | Фильтры: ${filterResults.join(', ')}`,
            takeProfitPrice: Number(takeProfitPrice.toFixed(8)),
            stopLossPrice: Number(stopLossPrice.toFixed(8)),
            sidewaysPattern: pattern,
            confirmation: confirmation,
        };

        // 🆕 ЛОГИРУЕМ СОЗДАНИЕ СИГНАЛА
        const confirmIcon = confirmation.overall ? '🟢' : '🟡';
        this.logger.log(
            `${confirmIcon} СИГНАЛ СОЗДАН [${direction}] ${pattern.symbol} | ` +
            `Фильтры: ${filterResults.join(' | ')}`
        );

        return signal;
    }

    /**
     * Открывает позицию по сигналу
     */
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
            confirmation: signal.confirmation, // 🆕 Сохраняем информацию о подтверждениях
        };

        this.openPositions.set(position.id, position);
        this.stats.totalTrades++;
        this.stats.openTrades++;

        // 🆕 Отображаем иконку в зависимости от подтверждений
        const confirmIcon = position.confirmation.overall ? '🟢' : '🟡';
        const confirmText = position.confirmation.overall ? 'ПОЛНОЕ ПОДТВЕРЖДЕНИЕ' : 'ЧАСТИЧНОЕ ПОДТВЕРЖДЕНИЕ';

        this.logger.log(`🔥 ${confirmIcon} ПОЗИЦИЯ ОТКРЫТА [${position.direction}] ${position.symbol} по ${this.formatPrice(position.entryPrice)} | ${confirmText}`);
        this.logger.log(`📊 TP: ${this.formatPrice(position.takeProfitPrice)} | SL: ${this.formatPrice(position.stopLossPrice)}`);
        this.logger.log(`📋 Подтверждения: BTC=${position.confirmation.btcTrend ? '✅' : '❌'} | VP=${position.confirmation.volumeProfile ? '✅' : '❌'} | OrderBook=${position.confirmation.overall ? '✅' : '❌'}`);

        // 🆕 Сохраняем торговый сигнал в Google Sheets
        this.saveSignalToGoogleSheets(signal, position);

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
        } else {
            // Логируем изменение PnL только если цена значительно изменилась
            const priceChangePercent = Math.abs((currentPrice - oldPrice) / oldPrice) * 100;
            if (priceChangePercent > 0.1) { // Если изменение больше 0.1%
                this.logger.debug(`💹 ${position.symbol} [${position.direction}] PnL: ${position.unrealizedPnl.toFixed(2)}% | Цена: ${this.formatPrice(currentPrice)}`);
            }
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

        this.logger.log(`${emoji} ПОЗИЦИЯ ЗАКРЫТА [${position.direction}] ${position.symbol} | ${pnlColor}${position.realizedPnl.toFixed(2)}% | ${reason}`);
        this.logger.log(`📈 Вход: ${this.formatPrice(position.entryPrice)} → Выход: ${this.formatPrice(closePrice)}`);

        // 🆕 Обновляем результат в Google Sheets
        this.updateSignalResultInGoogleSheets(position);

        // Логируем статистику каждые 5 закрытых сделок
        if (this.stats.closedTrades % 5 === 0) {
            this.logTradingStats();
        }
    }

    /**
     * Проверяет, можно ли открыть позицию для символа
     */
    private canOpenPosition(symbol: string): boolean {
        const symbolPositions = Array.from(this.openPositions.values())
            .filter(pos => pos.symbol === symbol).length;

        // Убрали проверку общего лимита позиций - теперь лимит только по символу
        return symbolPositions < this.config.maxPositionsPerSymbol;
    }

    /**
     * Возвращает статистику торговли
     */
    getTradingStats(): TradingStats {
        return {...this.stats};
    }

    /**
     * Логирует текущую статистику
     */
    logTradingStats(): void {
        this.logger.log(`📊 СТАТИСТИКА ТОРГОВЛИ:`);
        this.logger.log(`   Всего сделок: ${this.stats.totalTrades} | Открыто: ${this.stats.openTrades} | Закрыто: ${this.stats.closedTrades}`);
        if (this.stats.closedTrades > 0) {
            this.logger.log(`   Выигрышных: ${this.stats.winTrades} | Проигрышных: ${this.stats.lossTrades} | Win Rate: ${this.stats.winRate.toFixed(1)}%`);
            this.logger.log(`   Общий PnL: ${this.stats.totalPnl.toFixed(2)}% | Средний PnL: ${this.stats.averagePnl.toFixed(2)}%`);
            this.logger.log(`   Лучшая сделка: +${this.stats.maxWin.toFixed(2)}% | Худшая: ${this.stats.maxLoss.toFixed(2)}%`);
        }
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
     * Возвращает позицию по символу (если есть)
     */
    getPositionBySymbol(symbol: string): TradingPosition | null {
        const positions = Array.from(this.openPositions.values()).filter(pos => pos.symbol === symbol);
        return positions.length > 0 ? positions[0] : null;
    }

    /**
     * Возвращает позиции по символу
     */
    getPositionsBySymbol(symbol: string): TradingPosition[] {
        return Array.from(this.openPositions.values()).filter(pos => pos.symbol === symbol);
    }

    /**
     * Закрывает позицию при смене тренда
     */
    private closePositionByReversal(position: TradingPosition, closePrice: number, reason: string): void {
        position.closedPrice = closePrice;
        position.closedTime = Date.now();
        position.closeReason = reason;
        position.status = 'CLOSED_SL'; // Помечаем как закрытую по внешней причине

        // Рассчитываем финальный PnL
        if (position.direction === 'LONG') {
            position.realizedPnl = ((closePrice - position.entryPrice) / position.entryPrice) * 100;
        } else {
            position.realizedPnl = ((position.entryPrice - closePrice) / position.entryPrice) * 100;
        }

        position.unrealizedPnl = position.realizedPnl;

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
        this.stats.winRate = this.stats.closedTrades > 0 ? (this.stats.winTrades / this.stats.closedTrades) * 100 : 0;
        this.stats.averagePnl = this.stats.closedTrades > 0 ? this.stats.totalPnl / this.stats.closedTrades : 0;

        // Переносим в историю
        this.closedPositions.push({...position});
        this.openPositions.delete(position.id);

        const emoji = position.realizedPnl > 0 ? '🔄✅' : '🔄❌';
        const pnlColor = position.realizedPnl > 0 ? '+' : '';

        this.logger.log(`${emoji} ПОЗИЦИЯ ЗАКРЫТА ПО СМЕНЕ ТРЕНДА [${position.direction}] ${position.symbol} | ${pnlColor}${position.realizedPnl.toFixed(2)}% | ${reason}`);
        this.logger.log(`📈 Вход: ${this.formatPrice(position.entryPrice)} → Выход: ${this.formatPrice(closePrice)}`);

        // 🆕 Обновляем результат в Google Sheets
        this.updateSignalResultInGoogleSheets(position);
    }

    /**
     * Сохраняет торговый сигнал в Google Sheets на страницу "page"
     */
    private async saveSignalToGoogleSheets(signal: TradingSignal, position: TradingPosition): Promise<void> {
        try {
            const googleSheetsSignal: GoogleSheetsSignal = {
                date: new Date().toISOString().split('T')[0], // Текущая дата в формате YYYY-MM-DD
                symbol: signal.symbol,
                VP: signal.confirmation.volumeProfile, // Volume Profile подтверждение
                BTC: signal.confirmation.btcTrend, // BTC тренд подтверждение
                orderBook: signal.confirmation.overall, // Order Book подтверждение (true/false)
                open: signal.entryPrice,
                side: signal.direction.toLowerCase() as 'long' | 'short',
                tp: signal.takeProfitPrice,
                sl: signal.stopLossPrice,
            };

            await this.signalService.createTradingSignal(googleSheetsSignal, 'page');

            const confirmStatus = signal.confirmation.overall ? '🟢 ПОЛНОЕ' : '🟡 ЧАСТИЧНОЕ';
            this.logger.log(`📊 Торговый сигнал сохранен в Google Sheets (page): ${signal.symbol} ${signal.direction} | ${confirmStatus} подтверждение`);
        } catch (error) {
            this.logger.error(`❌ Ошибка сохранения сигнала в Google Sheets: ${error.message}`);
        }
    }

    /**
     * Обновляет результат торгового сигнала в Google Sheets при закрытии позиции
     * Записывает на страницу "page" обновление результата и на "closed-trades" полную информацию о закрытой сделке
     */
    private async updateSignalResultInGoogleSheets(position: TradingPosition): Promise<void> {
        try {
            // 1. Обновляем результат на странице "page"
            const googleSheetsSignal: GoogleSheetsSignal = {
                date: new Date(position.entryTime).toISOString().split('T')[0], // Дата входа
                symbol: position.symbol,
                VP: position.confirmation.volumeProfile,
                BTC: position.confirmation.btcTrend,
                orderBook: position.confirmation.overall,
                open: position.entryPrice,
                side: position.direction.toLowerCase() as 'long' | 'short',
                tp: position.takeProfitPrice,
                sl: position.stopLossPrice,
                result: position.realizedPnl, // Результат в процентах
            };

            await this.signalService.updateTradingSignalResult(googleSheetsSignal, 'page');

            // 2. Сохраняем закрытую сделку на страницу "closed-trades" с полной датой и временем
            const closedTradeSignal: GoogleSheetsSignal = {
                date: this.formatFullDateTime(position.closedTime || Date.now()), // Дата и время закрытия в формате YYYY-MM-DD HH:MM:SS
                symbol: position.symbol,
                VP: position.confirmation.volumeProfile,
                BTC: position.confirmation.btcTrend,
                orderBook: position.confirmation.overall,
                open: position.entryPrice,
                side: position.direction.toLowerCase() as 'long' | 'short',
                tp: position.takeProfitPrice,
                sl: position.stopLossPrice,
                result: position.realizedPnl,
            };

            await this.signalService.createTradingSignal(closedTradeSignal, 'closed-trades');

            const pnlIcon = (position.realizedPnl ?? 0) > 0 ? '✅' : '❌';
            const confirmStatus = position.confirmation.overall ? '🟢' : '🟡';
            this.logger.log(`📊 ${pnlIcon} Результат обновлен в Google Sheets (page): ${position.symbol} ${position.realizedPnl?.toFixed(2)}% | ${confirmStatus}`);
            this.logger.log(`📊 ${pnlIcon} Закрытая сделка сохранена в Google Sheets (closed-trades): ${position.symbol} ${position.realizedPnl?.toFixed(2)}%`);
        } catch (error) {
            this.logger.error(`❌ Ошибка обновления результата в Google Sheets: ${error.message}`);
        }
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
     * Форматирует дату и время для отображения в формате YYYY-MM-DD HH:MM:SS
     */
    private formatFullDateTime(timestamp: number): string {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * 🔥 ВАЛИДАЦИЯ С VOLUME PROFILE: Проверяет боковик с помощью Volume Profile
     */
    private async validateWithVolumeProfile(pattern: SidewaysPattern): Promise<boolean> {
        try {
            // Пока что возвращаем true для тестирования новой логики
            // В дальнейшем здесь будет полная интеграция с VolumeProfileService
            this.logger.debug(`${pattern.symbol}: VP валидация: временно возвращает true для тестирования`);
            return true;

        } catch (error) {
            this.logger.error(`${pattern.symbol}: Ошибка Volume Profile валидации:`, (error as Error).message);
            return false;
        }
    }
}
