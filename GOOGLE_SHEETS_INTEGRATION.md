# Интеграция с Google Sheets

Этот проект интегрирован с Google Sheets для автоматического сохранения торговых сигналов и результатов.

## Настройка Google Sheets

### 1. Создание Service Account

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите Google Sheets API
4. Создайте Service Account:
   - Перейдите в IAM & Admin > Service Accounts
   - Нажмите "Create Service Account"
   - Заполните детали и создайте
   - Создайте JSON ключ для Service Account

### 2. Настройка Google Таблицы

1. Создайте новую Google Таблицу
2. Создайте лист с названием `trades` со следующими колонками (строка 1):
   - A: `date` - дата сигнала
   - B: `symbol` - тикер
   - C: `VP` - подтверждение по volume profile (true/false)
   - D: `BTC` - подтверждение по тренду BTC (true/false)
   - E: `Order Book` - подтверждение по стакану (true/false)
   - F: `open` - цена входа
   - G: `side` - направление (long/short)
   - H: `tp` - цена take profit
   - I: `sl` - цена stop loss
   - J: `result` - итоговый результат в процентах

3. Создайте лист с названием `logs` для логирования:
   - A: timestamp
   - B: log message

4. Поделитесь таблицей с Service Account email (дайте права редактора)

### 3. Переменные окружения

Создайте файл `.env` и добавьте следующие переменные:

```env
# Google Sheets credentials (JSON от Service Account)
GOOGLE_SHEETS_CREDENTIALS={"type":"service_account","project_id":"your-project-id",...}

# ID Google Таблицы (из URL таблицы)
GOOGLE_SHEETS_TRADING_SPREADSHEET_ID=your_spreadsheet_id_here

# Включение интеграции
GOOGLE_SHEETS_ENABLED=true
```

## Структура данных в таблице

### Лист "trades"
Каждая строка представляет торговый сигнал:

| date | symbol | VP | BTC | Order Book | open | side | tp | sl | result |
|------|--------|----|----|------------|------|------|----|----|---------|
| 2024-01-01 | BTCUSDT | TRUE | TRUE | FALSE | 45000 | long | 45900 | 44100 | 2.5 |

### Лист "logs"
Каждая строка представляет лог-запись:

| timestamp | message |
|-----------|---------|
| 2024-01-01 10:30:15 | Trading signal created for BTCUSDT |

## API Endpoints

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

### Создание нескольких сигналов
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

## Автоматическое сохранение

Торговый сервис автоматически сохраняет данные в следующих случаях:

1. **При открытии позиции** - сохраняется торговый сигнал без результата
2. **При закрытии позиции** - обновляется запись с результатом в процентах
3. **При логировании** - важные события сохраняются в лист "logs"

## Troubleshooting

### Ошибка аутентификации
- Проверьте правильность JSON credentials
- Убедитесь, что Service Account имеет доступ к таблице
- Проверьте, что Google Sheets API включен в проекте

### Ошибка "spreadsheet not found"
- Проверьте правильность GOOGLE_SHEETS_TRADING_SPREADSHEET_ID
- Убедитесь, что таблица существует и доступна

### Данные не сохраняются
- Проверьте, что GOOGLE_SHEETS_ENABLED=true
- Проверьте логи приложения на наличие ошибок
- Убедитесь, что листы "trades" и "logs" существуют

## Пример полной настройки

1. Получите ID таблицы из URL: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
2. Добавьте в .env:
```env
GOOGLE_SHEETS_TRADING_SPREADSHEET_ID=1A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T
GOOGLE_SHEETS_CREDENTIALS={"type":"service_account","project_id":"my-trading-bot","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"trading-bot@my-trading-bot.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}
GOOGLE_SHEETS_ENABLED=true
```

3. Запустите приложение:
```bash
npm install
npm run start:dev
```

Теперь все торговые сигналы будут автоматически сохраняться в вашу Google Таблицу!
