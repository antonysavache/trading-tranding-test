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
  // Информация о ширине канала
  channelWidthPercent: number; // Ширина канала в процентах
  highLevel: number; // Верхний уровень канала
  lowLevel: number; // Нижний уровень канала
}

export interface AnalysisConfig {
  lookbackPeriod: number;
  minPriceMovement: number;
  returnThreshold: number;
}
