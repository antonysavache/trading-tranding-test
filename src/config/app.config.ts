export default () => ({
  binance: {
    baseUrl: 'https://fapi.binance.com', // Фьючерсы API
    wsUrl: 'wss://fstream.binance.com/ws', // Фьючерсы WebSocket
    interval: '1m',
    topPairsLimit: 150, // Ограничим до 150 фьючерсных пар
  },
  analysis: {
    lookbackPeriod: 3, // Уменьшили для минутных свечей
    minPriceMovement: 0.01, // МИНИМУМ 2% движение между верхом и низом
    returnThreshold: 0.005, // Порог возврата к первоначальному уровню (0.5%)
    bufferSize: 300, // Больше буфер для минутных данных (5 часов)
    analysisInterval: 60000, // Анализ каждую минуту (60 секунд)
    // 🆕 НАСТРОЙКИ ДЛЯ ТРЕНД-АНАЛИЗА
    minTrendStepPercent: 1.0, // Минимальный размер ступени тренда 1%
    maxTrendStepPercent: 10.0, // Максимальный размер ступени тренда 10%
  },
  logging: {
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    timezone: 'Europe/Moscow',
  },
  trading: {
    enabled: true,
    takeProfitPercent: 3.0, // 3% тейк-профит для тренд-стратегии
    stopLossPercent: 2.0,   // 2% стоп-лосс
    maxPositionsPerSymbol: 2, // Больше позиций для тренд-торговли
    maxTotalPositions: 999,   // Убираем ограничение
  },
});
