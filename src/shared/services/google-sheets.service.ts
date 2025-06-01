import {Injectable} from '@nestjs/common';
import {google, sheets_v4} from 'googleapis';
import {JWT} from 'google-auth-library';
import {Observable, from, of, throwError} from 'rxjs';
import {tap, switchMap, catchError, map} from 'rxjs/operators';
import {IGoogleSheetsService} from '../models/google-sheets.interface';
import {TradingSignal} from '../models/trading-signal.interface';

@Injectable()
export class GoogleSheetsService implements IGoogleSheetsService {
    private auth: JWT | null = null;
    private sheets: sheets_v4.Sheets | null = null;
    private initialized = false;
    private readonly spreadsheetId: string;

    constructor() {
        this.spreadsheetId = process.env.GOOGLE_SHEETS_TRADING_SPREADSHEET_ID || '';
    }

    initialize(): Observable<void> {
        if (this.initialized) {
            console.log('GoogleSheetsService: Already initialized');
            return of(undefined);
        }

        return from(this.initializeSheets()).pipe(
            tap(() => {
                this.initialized = true;
                console.log('GoogleSheetsService: Initialized successfully');

                if (!this.spreadsheetId) {
                    console.warn('GoogleSheetsService: GOOGLE_SHEETS_TRADING_SPREADSHEET_ID is not set!');
                }
            }),
            catchError(error => {
                console.error('GoogleSheetsService: Initialization failed:', error);
                return throwError(() => error);
            })
        );
    }

    saveTradingSignals(signals: TradingSignal[], sheetName: string = 'page'): Observable<void> {
        if (!signals.length) {
            console.log('GoogleSheetsService: No trading signals to save, returning early');
            return of(undefined);
        }

        return this.ensureInitialized().pipe(
            tap(() => console.log(`GoogleSheetsService: Successfully initialized, proceeding to save ${signals.length} trading signals`)),
            switchMap(() => {
                if (!this.spreadsheetId) {
                    return throwError(() => new Error('GoogleSheetsService: GOOGLE_SHEETS_TRADING_SPREADSHEET_ID is not set!'));
                }

                // Обрабатываем каждый сигнал отдельно
                const operations = signals.map(signal => {
                    if (signal.result !== undefined) {
                        // Если есть результат - ищем и обновляем существующую запись
                        return this.updateExistingSignal(signal, sheetName);
                    } else {
                        // Если нет результата - добавляем новую запись
                        return this.addNewSignal(signal, sheetName);
                    }
                });

                // Выполняем все операции последовательно
                return from(Promise.all(operations.map(op => op.toPromise()))).pipe(
                    map(() => {
                        console.log(`GoogleSheetsService: Successfully processed ${signals.length} trading signals in ${sheetName}`);
                        return undefined as void;
                    })
                );
            }),
            catchError(error => {
                console.error(`GoogleSheetsService: Error processing trading signals in sheet ${sheetName}:`, error);
                if (error.response) {
                    console.error(`Status: ${error.response.status}, Data:`, error.response.data);
                }
                return throwError(() => error);
            })
        );
    }

    /**
     * Добавляет новый торговый сигнал в таблицу
     */
    private addNewSignal(signal: TradingSignal, sheetName: string): Observable<void> {
        // Для страницы closed-trades используем дату с временем как есть,
        // для остальных страниц - только дату
        const dateValue = sheetName === 'closed-trades' ?
            `'${signal.date}` :  // Для closed-trades date уже содержит время
            `'${signal.date}`;   // Для остальных - только дата

        const row = [
            dateValue,                   // дата (с временем для closed-trades)
            `'${signal.symbol}`,         // символ как текст
            signal.VP,                   // VP как boolean
            signal.BTC,                  // BTC как boolean
            signal.orderBook,            // Order Book как boolean
            parseFloat(String(signal.open)) || 0,  // цена входа как число
            `'${signal.side}`,           // сторона как текст
            parseFloat(String(signal.tp)) || 0,    // TP как число
            parseFloat(String(signal.sl)) || 0,    // SL как число
            signal.result !== undefined ? (parseFloat(String(signal.result)) || 0) : ''  // результат для closed-trades
        ];

        const range = `${sheetName}!A:J`;

        console.log(`GoogleSheetsService: Adding new signal to ${sheetName}: ${signal.symbol} ${signal.side} at ${signal.open}`);

        return from(this.sheets!.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [row]
            }
        })).pipe(
            map(() => {
                console.log(`GoogleSheetsService: Successfully added new signal for ${signal.symbol} to ${sheetName}`);
                return undefined as void;
            })
        );
    }

    /**
     * Обновляет результат существующего торгового сигнала
     */
    private updateExistingSignal(signal: TradingSignal, sheetName: string): Observable<void> {
        // Для страницы closed-trades просто добавляем новую запись (не обновляем существующую)
        if (sheetName === 'closed-trades') {
            console.log(`GoogleSheetsService: Adding closed trade to ${sheetName}: ${signal.symbol} ${signal.side} with result ${signal.result}%`);
            return this.addNewSignal(signal, sheetName);
        }

        console.log(`GoogleSheetsService: Looking for existing signal to update: ${signal.symbol} ${signal.side} at ${signal.open} with result ${signal.result}%`);

        // Сначала получаем все данные из листа
        const range = `${sheetName}!A:J`;

        return from(this.sheets!.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: range
        })).pipe(
            switchMap(response => {
                const rows = response.data.values || [];

                // Ищем строку с совпадающими параметрами (дата, символ, сторона, цена входа)
                let targetRowIndex = -1;

                for (let i = 1; i < rows.length; i++) { // Начинаем с 1, пропуская заголовок
                    const row = rows[i];
                    if (row.length >= 7) {
                        // Получаем данные с очисткой апострофов
                        const rowDate = String(row[0] || '').replace(/'/g, '');
                        const rowSymbol = String(row[1] || '').replace(/'/g, '');
                        const rowSide = String(row[6] || '').replace(/'/g, '');
                        const rowOpen = parseFloat(String(row[5] || '0'));

                        // Очищаем данные сигнала для сравнения
                        const signalDate = signal.date;
                        const signalSymbol = signal.symbol;
                        const signalSide = signal.side;
                        const signalOpen = signal.open;

                        // Проверяем совпадение всех ключевых параметров с лучшей точностью
                        const dateMatch = rowDate === signalDate;
                        const symbolMatch = rowSymbol === signalSymbol;
                        const sideMatch = rowSide === signalSide;
                        // Для цены используем относительную погрешность 0.01%
                        const priceMatch = Math.abs(rowOpen - signalOpen) / signalOpen < 0.0001;

                        console.log(`GoogleSheetsService: Row ${i + 1} check - Date:${dateMatch} Symbol:${symbolMatch} Side:${sideMatch} Price:${priceMatch}`);
                        console.log(`  Row data: ${rowDate}|${rowSymbol}|${rowSide}|${rowOpen}`);
                        console.log(`  Signal:   ${signalDate}|${signalSymbol}|${signalSide}|${signalOpen}`);

                        if (dateMatch && symbolMatch && sideMatch && priceMatch) {
                            targetRowIndex = i + 1; // +1 потому что Google Sheets индексация с 1
                            console.log(`GoogleSheetsService: ✅ Found exact match at row ${targetRowIndex}`);
                            break;
                        }
                    }
                }

                if (targetRowIndex === -1) {
                    console.log(`GoogleSheetsService: ❌ No matching signal found, adding as new record`);
                    return this.addNewSignal(signal, sheetName);
                }

                // Обновляем только колонку J (результат) в найденной строке
                const updateRange = `${sheetName}!J${targetRowIndex}`;
                const resultValue = parseFloat(String(signal.result)) || 0;

                console.log(`GoogleSheetsService: ✅ Updating result in ${updateRange} with value ${resultValue}%`);

                return from(this.sheets!.spreadsheets.values.update({
                    spreadsheetId: this.spreadsheetId,
                    range: updateRange,
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [[resultValue]]
                    }
                })).pipe(
                    map(() => {
                        console.log(`GoogleSheetsService: ✅ Successfully updated result for ${signal.symbol} to ${signal.result}%`);
                        return undefined as void;
                    })
                );
            })
        );
    }

    saveLog(logEntry: string): Observable<void> {
        console.log(`GoogleSheetsService: Saving log entry: ${logEntry}`);

        return this.ensureInitialized().pipe(
            switchMap(() => {
                if (!this.spreadsheetId) {
                    return throwError(() => new Error('GoogleSheetsService: No spreadsheet ID configured'));
                }

                // Создаем запись лога с текущей датой и временем
                const now = new Date();
                const timestamp = now.toISOString().replace('T', ' ').substring(0, 19); // Формат: YYYY-MM-DD HH:MM:SS

                // Форматируем строку для записи
                const row = [
                    `'${timestamp}`, // Дата и время как текст
                    `'${logEntry}`   // Текст лога как текст
                ];

                // Фиксированная страница "logs"
                const range = `logs!A:B`;

                return from(this.sheets!.spreadsheets.values.append({
                    spreadsheetId: this.spreadsheetId,
                    range: range,
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    requestBody: {
                        values: [row]
                    }
                })).pipe(
                    map(() => {
                        console.log(`GoogleSheetsService: Log entry saved successfully`);
                        return undefined as void;
                    })
                );
            }),
            catchError(error => {
                console.error(`GoogleSheetsService: Error saving log:`, error);
                return throwError(() => error);
            })
        );
    }

    private ensureInitialized(): Observable<void> {
        if (this.initialized && this.sheets) {
            return of(undefined);
        }

        console.log('GoogleSheetsService: Not initialized yet, calling initialize()');
        return this.initialize().pipe(
            tap(() => {
                if (!this.sheets) {
                    console.error('GoogleSheetsService: sheets is still null after initialize()!');
                }
            })
        );
    }

    private async initializeSheets(): Promise<void> {
        const credentialsStr = process.env.GOOGLE_SHEETS_CREDENTIALS;
        if (!credentialsStr) {
            throw new Error('GOOGLE_SHEETS_CREDENTIALS environment variable is not set');
        }

        try {
            const credentials = JSON.parse(credentialsStr);

            console.log(`GoogleSheetsService: Initializing with client_email: ${credentials.client_email}`);
            console.log(`GoogleSheetsService: Using spreadsheet ID: ${this.spreadsheetId}`);

            if (!this.spreadsheetId) {
                console.warn('GoogleSheetsService: GOOGLE_SHEETS_TRADING_SPREADSHEET_ID is not set!');
            }

            this.auth = new JWT({
                email: credentials.client_email,
                key: credentials.private_key,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });

            this.sheets = google.sheets({version: 'v4', auth: this.auth});

        } catch (error) {
            console.error('GoogleSheetsService: Error parsing credentials or initializing:', error);
            throw error;
        }
    }
}
