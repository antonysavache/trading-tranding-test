export default () => ({
  binance: {
    baseUrl: 'https://fapi.binance.com', // Фьючерсы API
    wsUrl: 'wss://fstream.binance.com/ws', // Фьючерсы WebSocket
    interval: '5m', // Переключаемся на 5-минутки
    topPairsLimit: 150, // Ограничим до 150 фьючерсных пар
  },
  analysis: {
    lookbackPeriod: 3, // Период для поиска локальных экстремумов
    minChannelWidthPercent: 2.5, // Увеличиваем минимальную ширину канала для 5m
    returnThreshold: 0.005, // Порог возврата к первоначальному уровню (0.5%)
    bufferSize: 60, // Буфер для 5-минутных данных (5 часов)
    analysisInterval: 300000, // Анализ каждые 5 минут (300 секунд)
  },
  trading: {
    enabled: true, // Включить/выключить торговлю
    maxPositions: 999, // Убираем лимит на количество позиций
    baseCurrency: 'USDT',
    positionSizePercent: 1, // 1% от баланса на позицию
    takeProfitMultiplier: 0.8, // Коэффициент тейк-профита (80% от высоты канала)
    stopLossMultiplier: 0.3, // Коэффициент стоп-лосса (30% от высоты канала)
    fees: {
      makerFeeRate: 0.0002, // 0.02% комиссия мейкера (как на Bybit)
      takerFeeRate: 0.0005, // 0.05% комиссия тейкера (как на Bybit)
    },
    riskManagement: {
      maxRiskPerTrade: 1.0, // Максимальный риск на сделку в %
      maxDailyLoss: 5.0, // Максимальная дневная потеря в %
      maxDrawdown: 10.0, // Максимальная просадка в %
    },
  },
  logging: {
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    timezone: 'Europe/Moscow',
  },
});
