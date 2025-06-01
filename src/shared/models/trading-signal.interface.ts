export interface TradingSignal {
  date: string;          // дата сигнала
  symbol: string;        // тикер
  VP: boolean;           // подтверждение по volume profile
  BTC: boolean;          // подтверждение по тренду BTC
  orderBook: boolean;    // подтверждение по стакану
  open: number;          // цена входа
  side: 'long' | 'short'; // направление сделки
  tp: number;            // цена take profit
  sl: number;            // цена stop loss
  result?: number;       // итоговый результат в процентах (опционально)
}
