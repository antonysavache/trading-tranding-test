import { Injectable, OnModuleInit } from '@nestjs/common';
import { GoogleSheetsService } from './services/google-sheets.service';
import { TradingSignal } from './models/trading-signal.interface';

@Injectable()
export class Repository implements OnModuleInit {
  constructor(
    private readonly googleSheetsService: GoogleSheetsService
  ) {}
  
  async onModuleInit() {
    try {
      await this.testGoogleSheetsConnection();
    } catch (error) {
      console.error('Repository.onModuleInit: Error testing Google Sheets connection:', error);
    }
  }
  
  private async testGoogleSheetsConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.googleSheetsService.initialize().subscribe({
        next: () => {
          console.log('Repository: Google Sheets service initialized successfully');
          resolve();
        },
        error: error => {
          console.error('Repository: Error initializing Google Sheets service:', error);
          reject(error);
        }
      });
    });
  }

  /**
   * Сохраняет торговые сигналы в Google Таблицу
   * @param signals Массив торговых сигналов
   * @param sheetName Имя листа (по умолчанию 'trades')
   */
  saveTradingSignals(signals: TradingSignal[], sheetName: string = 'page'): void {
    if (!signals.length) {
      console.log('Repository: No trading signals to save');
      return;
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_TRADING_SPREADSHEET_ID;
    if (!spreadsheetId) {
      console.error('Repository: GOOGLE_SHEETS_TRADING_SPREADSHEET_ID is not set!');
      return;
    }

    this.googleSheetsService.saveTradingSignals(signals, sheetName)
      .subscribe({
        next: () => console.log(`Repository: Trading signals saved successfully to ${sheetName}`),
        error: error => {
          console.error(`Repository: Error saving trading signals to ${sheetName}:`, error);
        }
      });
  }

  /**
   * Сохраняет запись лога в Google Таблицу
   * @param logEntry Текст записи лога
   */
  saveLog(logEntry: string): void {
    console.log(`Repository: Saving log entry: ${logEntry}`);
    
    this.googleSheetsService.saveLog(logEntry)
      .subscribe({
        next: () => console.log(`Repository: Log entry saved successfully`),
        error: error => {
          console.error(`Repository: Error saving log entry:`, error);
        }
      });
  }
}
