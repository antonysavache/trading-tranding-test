export interface TradingPosition {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  currentPrice: number;
  
  // Цели и стопы
  takeProfitPrice: number;
  stopLossPrice: number;
  
  // Статус
  status: 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL';
  closedPrice?: number;
  closedTime?: number;
  
  // PnL
  unrealizedPnl: number; // В процентах
  realizedPnl?: number; // В процентах (когда закрыта)
  
  // Метаданные
  triggerReason: string; // Почему была открыта позиция
  closeReason?: string; // Почему была закрыта
  
  // 🆕 Подтверждение фильтрами
  confirmation: {
    btcTrend: boolean; // Подтверждается ли BTC трендом
    volumeProfile: boolean; // Подтверждается ли Volume Profile
    overall: boolean; // Общее подтверждение (все фильтры)
  };
}

export interface TradingSignal {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  timestamp: number;
  reason: string;
  
  // Автоматически рассчитанные уровни
  takeProfitPrice: number;
  stopLossPrice: number;
  
  // Дополнительная информация
  sidewaysPattern?: any; // Паттерн, который вызвал сигнал
  
  // 🆕 Подтверждение фильтрами (заполняется при создании сигнала)
  confirmation: {
    btcTrend: boolean; // Подтверждается ли BTC трендом
    volumeProfile: boolean; // Подтверждается ли Volume Profile
    overall: boolean; // Общее подтверждение (все фильтры)
  };
}

export interface TradingStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  
  winTrades: number;
  lossTrades: number;
  winRate: number; // В процентах
  
  totalPnl: number; // В процентах
  averagePnl: number; // В процентах
  
  maxWin: number; // В процентах
  maxLoss: number; // В процентах
}

export interface TradingConfig {
  enabled: boolean;
  takeProfitPercent: number; // Процент тейк-профита от цены входа
  stopLossPercent: number; // Процент стоп-лосса от цены входа (должен быть равен takeProfitPercent)
  maxPositionsPerSymbol: number;
  maxTotalPositions: number;
}
