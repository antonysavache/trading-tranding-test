export interface Position {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  entryTime: number;
  takeProfit: number;
  stopLoss: number;
  channelWidth: number; // Ширина боковика в %
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  closePrice?: number;
  closeTime?: number;
  pnl?: number;
  reason?: 'TAKE_PROFIT' | 'STOP_LOSS' | 'REVERSE' | 'MANUAL';
}

export interface TradeSignal {
  symbol: string;
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'REVERSE';
  price: number;
  timestamp: number;
  channelWidth: number; // Ширина боковика в %
  reason: string;
  takeProfit: number;
  stopLoss: number;
  filters?: {
    trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    trendStrength: number;
    allowLong: boolean;
    allowShort: boolean;
    reason: string;
    details?: {
      emaFilter: {
        enabled: boolean;
        trendDirection: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
        trendStrength: number;
        passed: boolean;
      };
      volumeFilter: {
        enabled: boolean;
        currentVolume: number;
        avgVolume: number;
        ratio: number;
        passed: boolean;
      };
      timeFilter: {
        enabled: boolean;
        currentHour: number;
        isWeekend: boolean;
        inAllowedHours: boolean;
        passed: boolean;
      };
      volatilityFilter: {
        enabled: boolean;
        atrPercent: number;
        minThreshold: number;
        maxThreshold: number;
        passed: boolean;
      };
    };
  };
}

export interface TradingConfig {
  enabled: boolean;
  maxPositions: number;
  baseCurrency: string; // Например 'USDT'
  positionSizePercent: number; // Процент от баланса на позицию
  takeProfitMultiplier: number; // 1.05
  stopLossMultiplier: number; // 0.95
  riskManagement: {
    maxRiskPerTrade: number; // Максимальный риск на сделку в %
    maxDailyLoss: number; // Максимальная дневная потеря в %
    maxDrawdown: number; // Максимальная просадка в %
  };
}

export interface TradingStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  activePosсitions: number;
}

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
}

export interface OrderResponse {
  orderId: string;
  symbol: string;
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';
  executedQty: number;
  executedPrice?: number;
  timestamp: number;
}
