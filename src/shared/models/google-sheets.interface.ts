import { Observable } from 'rxjs';
import { TradingSignal } from './trading-signal.interface';

export interface IGoogleSheetsService {
  initialize(): Observable<void>;
  saveTradingSignals(signals: TradingSignal[], sheetName: string): Observable<void>;
  saveLog(logEntry: string): Observable<void>;
}
