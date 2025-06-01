import {Injectable} from '@nestjs/common';
import {Repository} from './repository';
import {LoggingService} from './services/logging.service';
import {TradingSignal} from './models/trading-signal.interface';

@Injectable()
export class SignalService {
    constructor(
        private readonly repository: Repository,
        private readonly loggingService: LoggingService,
    ) {
    }

    /**
     * Создает и сохраняет торговый сигнал
     * @param signalData Данные для создания сигнала
     * @param sheetName Имя листа для сохранения (по умолчанию 'page')
     * @returns Promise<void>
     */
    async createTradingSignal(
        signalData: Omit<TradingSignal, 'date'> | TradingSignal,
        sheetName: string = 'page'
    ): Promise<void> {
        try {
            let signal: TradingSignal;

            if ('date' in signalData) {
                // Если дата уже есть (например, для closed-trades), используем её
                signal = signalData as TradingSignal;
            } else {
                // Если даты нет, добавляем текущую дату для страницы page
                signal = {
                    ...signalData,
                    date: new Date().toISOString().split('T')[0], // Текущая дата в формате YYYY-MM-DD
                };
            }

            this.loggingService.info(
                `Creating trading signal for ${signal.symbol} - ${signal.side} at ${signal.open} on sheet ${sheetName}`,
                'SignalService'
            );

            this.repository.saveTradingSignals([signal], sheetName);

            this.loggingService.info(
                `Trading signal saved successfully for ${signal.symbol} on sheet ${sheetName}`,
                'SignalService'
            );
        } catch (error) {
            this.loggingService.error(
                `Failed to create trading signal: ${error.message}`,
                'SignalService'
            );
            throw error;
        }
    }

    /**
     * Создает и сохраняет несколько торговых сигналов
     * @param signalsData Массив данных для создания сигналов
     * @param sheetName Имя листа для сохранения (по умолчанию 'page')
     * @returns Promise<void>
     */
    async createMultipleTradingSignals(
        signalsData: (Omit<TradingSignal, 'date'> | TradingSignal)[],
        sheetName: string = 'page'
    ): Promise<void> {
        try {
            const signals: TradingSignal[] = signalsData.map(signalData => {
                if ('date' in signalData) {
                    // Если дата уже есть, используем её
                    return signalData as TradingSignal;
                } else {
                    // Если даты нет, добавляем текущую дату
                    return {
                        ...signalData,
                        date: new Date().toISOString().split('T')[0], // Текущая дата в формате YYYY-MM-DD
                    };
                }
            });

            this.loggingService.info(
                `Creating ${signals.length} trading signals on sheet ${sheetName}`,
                'SignalService'
            );

            this.repository.saveTradingSignals(signals, sheetName);

            this.loggingService.info(
                `${signals.length} trading signals saved successfully on sheet ${sheetName}`,
                'SignalService'
            );
        } catch (error) {
            this.loggingService.error(
                `Failed to create multiple trading signals: ${error.message}`,
                'SignalService'
            );
            throw error;
        }
    }

    /**
     * Обновляет результат торгового сигнала
     * @param signalData Полные данные сигнала с результатом
     * @param sheetName Имя листа для сохранения (по умолчанию 'page')
     * @returns Promise<void>
     */
    async updateTradingSignalResult(
        signalData: TradingSignal,
        sheetName: string = 'page'
    ): Promise<void> {
        try {
            this.loggingService.info(
                `Updating trading signal result for ${signalData.symbol}: ${signalData.result}%`,
                'SignalService'
            );

            this.repository.saveTradingSignals([signalData], sheetName);

            this.loggingService.info(
                `Trading signal result updated successfully for ${signalData.symbol}`,
                'SignalService'
            );
        } catch (error) {
            this.loggingService.error(
                `Failed to update trading signal result: ${error.message}`,
                'SignalService'
            );
            throw error;
        }
    }
}
