import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {KlineData} from '../../interfaces/kline.interface';
import {PricePoint, TrendPattern, TrendMovement} from '../../interfaces/analysis.interface';

@Injectable()
export class TrendAnalysisService {
    private readonly logger = new Logger(TrendAnalysisService.name);
    private readonly lookbackPeriod: number;
    private readonly minTrendStepPercent: number;
    private readonly maxTrendStepPercent: number;

    // Хранилище активных движений для каждого символа
    private readonly activeTrendMovements: Map<string, TrendMovement> = new Map();

    constructor(private configService: ConfigService) {
        this.lookbackPeriod = this.configService.get<number>('analysis.lookbackPeriod', 3);
        this.minTrendStepPercent = this.configService.get<number>('analysis.minTrendStepPercent', 1.0); // 1%
        this.maxTrendStepPercent = this.configService.get<number>('analysis.maxTrendStepPercent', 10.0); // 10%

        this.logger.log(`Trend Analysis Service инициализирован | Мин. ступень: ${this.minTrendStepPercent}% | Макс. ступень: ${this.maxTrendStepPercent}%`);
    }

    /**
     * Анализирует klines на предмет трендовых паттернов
     */
    analyzeKlines(klines: KlineData[]): TrendPattern[] {
        if (klines.length < this.lookbackPeriod * 2 + 1) {
            return [];
        }

        const symbol = klines[0]?.symbol;
        if (!symbol) return [];

        const patterns: TrendPattern[] = [];

        // Для минутных свечей используем последние 20 минут
        const recentKlines = klines.slice(-20);

        // Находим локальные максимумы и минимумы
        const pricePoints = this.findLocalExtremes(recentKlines);

        if (pricePoints.length === 0) {
            return patterns;
        }

        // Обновляем активное движение или создаем новое
        this.updateTrendMovement(symbol, pricePoints, recentKlines);

        // Проверяем на завершенный тренд
        const completedPattern = this.checkForTrendCompletion(symbol, recentKlines);
        if (completedPattern) {
            patterns.push(completedPattern);
        }

        return patterns;
    }

    /**
     * Находит локальные экстремумы в данных о ценах
     */
    private findLocalExtremes(klines: KlineData[]): PricePoint[] {
        const points: PricePoint[] = [];

        for (let i = this.lookbackPeriod; i < klines.length - this.lookbackPeriod; i++) {
            const current = klines[i];
            const currentHigh = parseFloat(current.high);
            const currentLow = parseFloat(current.low);

            // Проверяем на локальный максимум
            if (this.isLocalHigh(klines, i)) {
                points.push({
                    price: currentHigh,
                    timestamp: current.closeTime,
                    type: 'high',
                    index: i,
                });
            }

            // Проверяем на локальный минимум
            if (this.isLocalLow(klines, i)) {
                points.push({
                    price: currentLow,
                    timestamp: current.closeTime,
                    type: 'low',
                    index: i,
                });
            }
        }

        // Сортируем по времени
        return points.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Проверяет, является ли точка локальным максимумом
     */
    private isLocalHigh(klines: KlineData[], index: number): boolean {
        const currentHigh = parseFloat(klines[index].high);

        for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
            if (i !== index && i >= 0 && i < klines.length) {
                if (parseFloat(klines[i].high) >= currentHigh) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Проверяет, является ли точка локальным минимумом
     */
    private isLocalLow(klines: KlineData[], index: number): boolean {
        const currentLow = parseFloat(klines[index].low);

        for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
            if (i !== index && i >= 0 && i < klines.length) {
                if (parseFloat(klines[i].low) <= currentLow) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Обновляет движение тренда для символа
     */
    private updateTrendMovement(symbol: string, pricePoints: PricePoint[], klines: KlineData[]): void {
        if (pricePoints.length === 0) return;

        let movement = this.activeTrendMovements.get(symbol);
        const latestPoint = pricePoints[pricePoints.length - 1];

        if (!movement) {
            // Начинаем новое движение
            movement = {
                symbol,
                points: [latestPoint],
                status: 'collecting_points',
                startTime: latestPoint.timestamp,
            };

            this.activeTrendMovements.set(symbol, movement);
            this.logger.debug(`${symbol}: Начат сбор точек тренда от ${latestPoint.type} ${latestPoint.price.toFixed(6)}`);
            return;
        }

        // Добавляем новые точки
        const lastPoint = movement.points[movement.points.length - 1];

        // Добавляем точку если она отличается от последней по типу
        if (lastPoint.type !== latestPoint.type) {
            movement.points.push(latestPoint);
            this.logger.debug(`${symbol}: Добавлена точка ${latestPoint.type} ${latestPoint.price.toFixed(6)}, всего точек: ${movement.points.length}`);

            // Если у нас есть 3 точки, проверяем тренд
            if (movement.points.length >= 3) {
                movement.status = 'trend_detected';
            }
        }
    }

    /**
     * 🎯 КЛЮЧЕВОЙ МЕТОД: Проверяет завершение тренда по 3 точкам
     */
    private checkForTrendCompletion(symbol: string, klines: KlineData[]): TrendPattern | null {
        const movement = this.activeTrendMovements.get(symbol);

        if (!movement || movement.status !== 'trend_detected' || movement.points.length < 3) {
            return null;
        }

        const currentPrice = parseFloat(klines[klines.length - 1].close);
        const [point1, point2, point3] = movement.points.slice(0, 3);

        // 🎯 ОПРЕДЕЛЯЕМ НАПРАВЛЕНИЕ ТРЕНДА
        let trendDirection: 'UPTREND' | 'DOWNTREND';

        if (point3.price > point1.price) {
            trendDirection = 'UPTREND';
        } else if (point3.price < point1.price) {
            trendDirection = 'DOWNTREND';
        } else {
            // Если точка3 равна точке1 - это не тренд
            return null;
        }

        // 🎯 РАССЧИТЫВАЕМ РАЗМЕР СТУПЕНИ
        const stepSize = Math.abs(point3.price - point1.price);
        const stepPercentage = (stepSize / Math.min(point1.price, point3.price)) * 100;

        // Проверяем что ступень в допустимых пределах
        if (stepPercentage < this.minTrendStepPercent || stepPercentage > this.maxTrendStepPercent) {
            this.logger.debug(`${symbol}: Ступень ${stepPercentage.toFixed(2)}% вне диапазона ${this.minTrendStepPercent}%-${this.maxTrendStepPercent}%`);
            return null;
        }

        // 🎯 РАССЧИТЫВАЕМ СЛЕДУЮЩИЕ УРОВНИ ВХОДА
        const nextLevels = this.calculateNextLevels(currentPrice, stepSize, trendDirection);

        // Логируем найденный тренд
        this.logger.log(
            `🎯 ТРЕНД НАЙДЕН: ${symbol} | ${trendDirection} | ` +
            `Точки: ${point1.price.toFixed(6)} → ${point2.price.toFixed(6)} → ${point3.price.toFixed(6)} | ` +
            `Ступень: ${stepPercentage.toFixed(2)}% (${stepSize.toFixed(6)}) | ` +
            `Уровни: LONG=${nextLevels.long.toFixed(6)} SHORT=${nextLevels.short.toFixed(6)}`
        );

        const pattern: TrendPattern = {
            symbol,
            point1,
            point2,
            point3,
            currentPrice,
            trendDirection,
            stepSize,
            stepPercentage,
            nextLevels,
            startTime: point1.timestamp,
            endTime: Date.now(),
        };

        // Удаляем обработанное движение
        this.activeTrendMovements.delete(symbol);

        return pattern;
    }

    /**
     * 🎯 Рассчитывает следующие уровни для входа в позицию
     */
    private calculateNextLevels(currentPrice: number, stepSize: number, trendDirection: 'UPTREND' | 'DOWNTREND'): {
        long: number;
        short: number
    } {
        if (trendDirection === 'UPTREND') {
            // В восходящем тренде:
            // LONG - покупаем на откате вниз (текущая цена - ступень)
            // SHORT - продаем на пробое вверх (текущая цена + ступень)
            return {
                long: currentPrice - stepSize,
                short: currentPrice + stepSize,
            };
        } else {
            // В нисходящем тренде:
            // LONG - покупаем на пробое вверх (текущая цена + ступень)
            // SHORT - продаем на продолжении вниз (текущая цена - ступень)
            return {
                long: currentPrice + stepSize,
                short: currentPrice - stepSize,
            };
        }
    }

    /**
     * Возвращает активные движения
     */
    getActiveTrendMovements(): Map<string, TrendMovement> {
        return new Map(this.activeTrendMovements);
    }

    /**
     * Очищает движение для символа
     */
    clearTrendMovement(symbol: string): void {
        this.activeTrendMovements.delete(symbol);
    }

    /**
     * Очищает все движения
     */
    clearAllTrendMovements(): void {
        this.activeTrendMovements.clear();
    }
}
