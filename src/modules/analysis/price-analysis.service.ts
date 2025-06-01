import {Injectable, Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {KlineData} from '../../interfaces/kline.interface';
import {PricePoint, PriceMovement, SidewaysPattern} from '../../interfaces/analysis.interface';
import {VolumeProfileService, VolumeAnalysis} from './volume-profile.service';

@Injectable()
export class PriceAnalysisService {
    private readonly logger = new Logger(PriceAnalysisService.name);
    private readonly lookbackPeriod: number;
    private readonly minPriceMovement: number;
    private readonly returnThreshold: number;

    // Хранилище активных движений для каждого символа
    private readonly activeMovements: Map<string, PriceMovement> = new Map();

    constructor(
        private configService: ConfigService,
        private volumeProfileService: VolumeProfileService,
    ) {
        this.lookbackPeriod = this.configService.get<number>('analysis.lookbackPeriod', 3);
        this.minPriceMovement = this.configService.get<number>('analysis.minPriceMovement', 0.0005);
        this.returnThreshold = this.configService.get<number>('analysis.returnThreshold', 0.001);
    }

    async analyzeKlines(klines: KlineData[]): Promise<SidewaysPattern[]> {
        if (klines.length < this.lookbackPeriod * 2 + 1) {
            return [];
        }

        const symbol = klines[0]?.symbol;
        if (!symbol) return [];

        const patterns: SidewaysPattern[] = [];

        // Для минутных свечей используем более простую логику
        // Ищем последние несколько свечей
        const recentKlines = klines.slice(-20); // Последние 20 минут

        // Находим локальные максимумы и минимумы
        const pricePoints = this.findLocalExtremes(recentKlines);

        if (pricePoints.length === 0) {
            return patterns;
        }

        // Обновляем активное движение или создаем новое
        this.updateMovement(symbol, pricePoints, recentKlines);

        // 🔥 ОБНОВЛЕННАЯ ЛОГИКА: Проверяем на завершенный боковик С Volume Profile
        const completedPattern = await this.checkForSidewaysCompletion(symbol, recentKlines);
        if (completedPattern) {
            patterns.push(completedPattern);
        }

        return patterns;
    }

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

    private isLocalHigh(klines: KlineData[], index: number): boolean {
        const currentHigh = parseFloat(klines[index].high);

        // Проверяем, что текущий максимум выше соседних свечей
        for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
            if (i !== index && i >= 0 && i < klines.length) {
                if (parseFloat(klines[i].high) >= currentHigh) {
                    return false;
                }
            }
        }

        return true;
    }

    private isLocalLow(klines: KlineData[], index: number): boolean {
        const currentLow = parseFloat(klines[index].low);

        // Проверяем, что текущий минимум ниже соседних свечей
        for (let i = index - this.lookbackPeriod; i <= index + this.lookbackPeriod; i++) {
            if (i !== index && i >= 0 && i < klines.length) {
                if (parseFloat(klines[i].low) <= currentLow) {
                    return false;
                }
            }
        }

        return true;
    }

    private updateMovement(symbol: string, pricePoints: PricePoint[], klines: KlineData[]): void {
        if (pricePoints.length === 0) return;

        let movement = this.activeMovements.get(symbol);
        const latestPoint = pricePoints[pricePoints.length - 1];
        const currentPrice = parseFloat(klines[klines.length - 1].close);

        if (!movement) {
            // Начинаем новое движение с первой найденной точки
            movement = {
                symbol,
                points: [latestPoint],
                status: latestPoint.type === 'high' ? 'waiting_for_low' : 'waiting_for_high',
                startTime: latestPoint.timestamp,
                direction: latestPoint.type === 'high' ? 'high_to_low_to_high' : 'low_to_high_to_low',
            };

            this.activeMovements.set(symbol, movement);
            this.logger.debug(`${symbol}: Начато движение от ${latestPoint.type} ${latestPoint.price}`);
            return;
        }

        // Обновляем существующее движение
        const lastPoint = movement.points[movement.points.length - 1];

        // Добавляем новую точку если она соответствует ожидаемому направлению
        if (this.shouldAddPoint(movement, latestPoint)) {
            movement.points.push(latestPoint);
            this.updateMovementStatus(movement, currentPrice);

            this.logger.debug(`${symbol}: Добавлена точка ${latestPoint.type} ${latestPoint.price}, статус: ${movement.status}`);
        }
    }

    private shouldAddPoint(movement: PriceMovement, newPoint: PricePoint): boolean {
        const lastPoint = movement.points[movement.points.length - 1];

        // Не добавляем точку того же типа подряд
        if (lastPoint.type === newPoint.type) {
            return false;
        }

        // Предварительная проверка на минимальное движение 2%
        if (movement.points.length === 1) {
            const priceRange = Math.abs(newPoint.price - lastPoint.price);
            const rangePercentage = (priceRange / Math.min(newPoint.price, lastPoint.price)) * 100;

            // Если движение меньше 2%, не добавляем точку
            if (rangePercentage < 2.0) {
                return false;
            }
        }

        // Проверяем соответствие ожидаемому направлению
        switch (movement.status) {
            case 'waiting_for_low':
                return newPoint.type === 'low';
            case 'waiting_for_high':
                return newPoint.type === 'high';
            default:
                return false;
        }
    }

    private updateMovementStatus(movement: PriceMovement, currentPrice: number): void {
        switch (movement.status) {
            case 'waiting_for_low':
                if (movement.points.length >= 2) {
                    movement.status = 'waiting_for_return';
                }
                break;
            case 'waiting_for_high':
                if (movement.points.length >= 2) {
                    movement.status = 'waiting_for_return';
                }
                break;
        }
    }

    private async checkForSidewaysCompletion(symbol: string, klines: KlineData[]): Promise<SidewaysPattern | null> {
        const movement = this.activeMovements.get(symbol);

        if (!movement || movement.status !== 'waiting_for_return' || movement.points.length < 2) {
            return null;
        }

        const currentPrice = parseFloat(klines[klines.length - 1].close);
        const firstPoint = movement.points[0];
        const secondPoint = movement.points[1];

        // ВАЖНО: Проверяем что расстояние между верхом и низом минимум 2%
        const highPrice = Math.max(firstPoint.price, secondPoint.price);
        const lowPrice = Math.min(firstPoint.price, secondPoint.price);
        const priceRange = Math.abs(highPrice - lowPrice);
        const rangePercentage = (priceRange / lowPrice) * 100;

        // Если расстояние меньше 2% - не считаем боковиком
        if (rangePercentage < 2.0) {
            this.logger.debug(`${symbol}: движение ${rangePercentage.toFixed(2)}% меньше минимума 2%`);
            return null;
        }

        // Проверяем возврат к первоначальному уровню
        const returnThreshold = firstPoint.price * this.returnThreshold;
        const priceDistance = Math.abs(currentPrice - firstPoint.price);

        if (priceDistance <= returnThreshold) {
            this.logger.log(`${symbol}: 🎯 БОКОВИК НАЙДЕН! Диапазон: ${rangePercentage.toFixed(2)}% | LOW: ${lowPrice.toFixed(6)} | HIGH: ${highPrice.toFixed(6)} | CURRENT: ${currentPrice.toFixed(6)}`);

            // Создаем паттерн боковика (без фильтров на этом этапе)
            const pattern: SidewaysPattern = {
                symbol,
                startPrice: firstPoint.price,
                middlePrice: secondPoint.price,
                endPrice: currentPrice,
                startTime: firstPoint.timestamp,
                endTime: Date.now(),
                direction: movement.direction,
                pricePoints: [...movement.points],
            };

            // Удаляем движение из активных
            this.activeMovements.delete(symbol);

            // Возвращаем найденный боковик БЕЗ применения фильтров
            return pattern;
        }

        return null;
    }

    getActiveMovements(): Map<string, PriceMovement> {
        return new Map(this.activeMovements);
    }

    clearMovement(symbol: string): void {
        this.activeMovements.delete(symbol);
    }

    clearAllMovements(): void {
        this.activeMovements.clear();
    }

}
