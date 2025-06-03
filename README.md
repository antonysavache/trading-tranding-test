# Торговый Бот с Google Sheets Интеграцией

Этот проект представляет собой торговый бот для анализа криптовалютных рынков с автоматическим сохранением торговых сигналов в Google Sheets.

## 🚀 Возможности

- **Анализ боковых движений** - автоматическое определение паттернов "боковик"
- **Торговые сигналы** - генерация торговых сигналов на основе анализа
- **Google Sheets интеграция** - автоматическое сохранение всех сигналов и результатов
- **Volume Profile анализ** - анализ объемного профиля
- **BTC тренд анализ** - фильтрация сигналов по тренду Bitcoin
- **Order Book анализ** - анализ книги ордеров для подтверждения сигналов
- **REST API** - создание сигналов через HTTP API
- **WebSocket мониторинг** - реальное время данных с Binance

## 📊 Структура Google Sheets

Проект автоматически сохраняет данные в Google Таблицу со следующей структурой:

### Лист "trades"
| Колонка | Описание |
|---------|----------|
| date | Дата сигнала (YYYY-MM-DD) |
| symbol | Торговая пара (например, BTCUSDT) |
| VP | Подтверждение по Volume Profile (true/false) |
| BTC | Подтверждение по тренду BTC (true/false) |
| Order Book | Подтверждение по стакану ордеров (true/false) |
| open | Цена входа в позицию |
| side | Направление сделки (long/short) |
| tp | Цена Take Profit |
| sl | Цена Stop Loss |
| result | Результат в процентах (заполняется при закрытии) |

### Лист "logs"
| Колонка | Описание |
|---------|----------|
| timestamp | Время события |
| message | Сообщение лога |

## 🛠 Установка и настройка

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка Google Sheets

1. Создайте проект в [Google Cloud Console](https://console.cloud.google.com/)
2. Включите Google Sheets API
3. Создайте Service Account и загрузите JSON ключ
4. Создайте Google Таблицу с листами "trades" и "logs"
5. Поделитесь таблицей с email Service Account

### 3. Переменные окружения

Создайте файл `.env`:

```env
# Google Sheets
GOOGLE_SHEETS_CREDENTIALS={"type":"service_account","project_id":"..."}
GOOGLE_SHEETS_TRADING_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEETS_ENABLED=true

# Trading
TRADING_ENABLED=true
TRADING_TAKE_PROFIT_PERCENT=2.0
TRADING_STOP_LOSS_PERCENT=2.0
TRADING_MAX_POSITIONS_PER_SYMBOL=1
TRADING_MAX_TOTAL_POSITIONS=10

# Server
API_PORT=3000
WS_PORT=3001
```

### 4. Запуск

```bash
# Разработка
npm run start:dev

# Продакшн
npm run build
npm run start:prod
```

## 📡 API Endpoints

### Создание торгового сигнала
```http
POST /signals
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "VP": true,
  "BTC": true,
  "orderBook": false,
  "open": 45000,
  "side": "long",
  "tp": 45900,
  "sl": 44100,
  "sheetName": "trades"
}
```

### Создание множественных сигналов
```http
POST /signals/multiple
Content-Type: application/json

{
  "signals": [
    {
      "symbol": "BTCUSDT",
      "VP": true,
      "BTC": true,
      "orderBook": false,
      "open": 45000,
      "side": "long",
      "tp": 45900,
      "sl": 44100
    }
  ],
  "sheetName": "trades"
}
```

### Обновление результата сигнала
```http
POST /signals/update-result
Content-Type: application/json

{
  "date": "2024-01-01",
  "symbol": "BTCUSDT",
  "VP": true,
  "BTC": true,
  "orderBook": false,
  "open": 45000,
  "side": "long",
  "tp": 45900,
  "sl": 44100,
  "result": 2.5,
  "sheetName": "trades"
}
```

### Получение статуса
```http
GET /
```

## 🔄 Автоматическое сохранение

Бот автоматически сохраняет данные в Google Sheets:

1. **При открытии позиции** - создается запись с торговым сигналом
2. **При закрытии позиции** - обновляется результат в процентах
3. **При логировании событий** - сохраняются важные события в лист "logs"

## 📈 Торговая логика

1. **Анализ боковых движений**: Поиск паттернов "максимум → минимум → максимум"
2. **Volume Profile**: Подтверждение сигнала по объемному профилю
3. **BTC тренд**: Фильтрация сигналов по направлению тренда Bitcoin
4. **Order Book**: Анализ глубины рынка для подтверждения
5. **Risk Management**: Автоматическое управление рисками с TP/SL

## 🏗 Архитектура

```
src/
├── shared/                    # Общие компоненты
│   ├── models/               # Интерфейсы данных
│   ├── services/             # Google Sheets и логирование
│   └── repository.ts         # Репозиторий данных
├── modules/
│   ├── signal/               # Модуль торговых сигналов
│   ├── trading/              # Торговая логика
│   ├── analysis/             # Анализ данных
│   └── data/                 # Источники данных
└── interfaces/               # TypeScript интерфейсы
```

## 🔧 Настройка торговли

В файле `.env` можно настроить параметры торговли:

- `TRADING_TAKE_PROFIT_PERCENT` - процент тейк-профита
- `TRADING_STOP_LOSS_PERCENT` - процент стоп-лосса
- `TRADING_MAX_POSITIONS_PER_SYMBOL` - максимум позиций на символ
- `TRADING_MAX_TOTAL_POSITIONS` - общий лимит позиций

## 📊 Мониторинг

Бот предоставляет подробную статистику:

- Количество найденных боковиков
- Статистика торговли (win rate, PnL)
- Активные позиции
- Статус BTC тренда
- Буферы данных

## 🚨 Безопасность

- Все данные сохраняются в защищенных Google Sheets
- Service Account для безопасного доступа к API
- Никаких торговых ключей в коде
- Только анализ и логирование сигналов

## 📚 Документация

Дополнительную документацию по интеграции с Google Sheets смотрите в файле `GOOGLE_SHEETS_INTEGRATION.md`.

## 🤝 Поддержка

При возникновении проблем:

1. Проверьте правильность настройки Google Sheets
2. Убедитесь в корректности переменных окружения
3. Проверьте логи приложения
4. Убедитесь в доступности Google Sheets API

## 📄 Лицензия

MIT License
# trading-test
