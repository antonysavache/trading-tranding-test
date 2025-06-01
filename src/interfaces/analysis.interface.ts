export interface PricePoint {
    price: number;
    timestamp: number;
    type: 'high' | 'low';
    index: number;
}

export interface PriceMovement {
    symbol: string;
    points: PricePoint[];
    status: 'waiting_for_low' | 'waiting_for_high' | 'waiting_for_return' | 'sideways_detected';
    startTime: number;
    direction: 'high_to_low_to_high' | 'low_to_high_to_low';
}

export interface SidewaysPattern {
    symbol: string;
    startPrice: number;
    middlePrice: number;
    endPrice: number;
    startTime: number;
    endTime: number;
    direction: 'high_to_low_to_high' | 'low_to_high_to_low';
    pricePoints: PricePoint[];
}

// 🆕 НОВЫЕ ИНТЕРФЕЙСЫ ДЛЯ ТРЕНД-СТРАТЕГИИ
export interface TrendPattern {
    symbol: string;
    point1: PricePoint; // Первая точка тренда
    point2: PricePoint; // Вторая точка (противоположная)
    point3: PricePoint; // Третья точка (определяет направление тренда)
    currentPrice: number; // Текущая цена
    trendDirection: 'UPTREND' | 'DOWNTREND'; // Направление тренда
    stepSize: number; // Размер ступени (разница между point3 и point1)
    stepPercentage: number; // Размер ступени в процентах
    nextLevels: {
        long: number;   // Следующий уровень для LONG (ниже текущей цены)
        short: number;  // Следующий уровень для SHORT (выше текущей цены)
    };
    startTime: number;
    endTime: number;
}

export interface TrendMovement {
    symbol: string;
    points: PricePoint[];
    status: 'collecting_points' | 'trend_detected' | 'waiting_for_entry';
    startTime: number;
    trendDirection?: 'UPTREND' | 'DOWNTREND';
}

export interface AnalysisConfig {
    lookbackPeriod: number;
    minPriceMovement: number;
    returnThreshold: number;
    // 🆕 Настройки для тренд-анализа
    minTrendStepPercent: number; // Минимальный размер ступени в процентах (например, 1%)
    maxTrendStepPercent: number; // Максимальный размер ступени в процентах (например, 10%)
}
