export default () => ({
  binance: {
    baseUrl: 'https://fapi.binance.com', // Фьючерсы API
    wsUrl: 'wss://fstream.binance.com/ws', // Фьючерсы WebSocket
    interval: '5m', // Переключаемся на 5-минутки
    topPairsLimit: 150, // Ограничим до 150 фьючерсных пар
  },
  analysis: {
    lookbackPeriod: 3, // Период для поиска локальных экстремумов
    minChannelWidthPercent: 1.5, // Снижаем до 1.5% для больше сигналов
    returnThreshold: 0.005, // Порог возврата к первоначальному уровню (0.5%)
    bufferSize: 60, // Буфер для 5-минутных данных (5 часов)
    analysisInterval: 300000, // Анализ каждые 5 минут (300 секунд)
    // Новые фильтры
    trendFilter: {
      enabled: true,
      ema20Period: 20,
      ema50Period: 50,
      ema200Period: 200,
      trendStrengthThreshold: 30, // Минимальная сила тренда для фильтрации
    },
    volumeFilter: {
      enabled: true,
      minVolumeMultiplier: 0.5, // Минимум 50% от среднего объема
      volumePeriod: 20, // Период для расчета среднего объема
    },
    timeFilter: {
      enabled: true,
      allowedHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], // UTC часы
      excludeWeekends: true,
    },
    volatilityFilter: {
      enabled: true,
      atrPeriod: 14,
      minAtrMultiplier: 0.3, // Минимальная волатильность
      maxAtrMultiplier: 3.0, // Максимальная волатильность
    },
  },
  trading: {
    enabled: true, // Включить/выключить торговлю
    maxPositions: 999, // Убираем лимит на количество позиций
    baseCurrency: 'USDT',
    positionSizePercent: 2, // Увеличиваем до 2% от баланса на позицию
    takeProfitMultiplier: 0.7, // Снижаем до 70% от высоты канала (быстрее закрываем)
    stopLossMultiplier: 0.5, // Увеличиваем до 50% от высоты канала (меньше ложных срабатываний)
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
