export default () => ({
  binance: {
    baseUrl: 'https://fapi.binance.com', // Фьючерсы API
    wsUrl: 'wss://fstream.binance.com/ws', // Фьючерсы WebSocket
    interval: '1m',
    topPairsLimit: 150, // Ограничим до 50 фьючерсных пар
  },
  analysis: {
    lookbackPeriod: 3, // Уменьшили для минутных свечей
    minPriceMovement: 0.01, // МИНИМУМ 2% движение между верхом и низом
    returnThreshold: 0.005, // Порог возврата к первоначальному уровню (0.5%)
    bufferSize: 300, // Больше буфер для минутных данных (5 часов)
    analysisInterval: 60000, // Анализ каждую минуту (60 секунд)
  },
  logging: {
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    timezone: 'Europe/Moscow',
  },
  trading: {
    enabled: true,
    takeProfitPercent: 2.0, // 2% тейк-профит
    stopLossPercent: 2.0,   // 2% стоп-лосс (равен TP для R:R = 1:1)
    maxPositionsPerSymbol: 1, // Максимум позиций на один символ
    maxTotalPositions: 999,   // Убираем ограничение (было 10)
  },
});
