import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Position, TradeSignal, TradingStats } from '../../interfaces/trading.interface';
import { SidewaysPattern } from '../../interfaces/analysis.interface';
import { KlineData } from '../../interfaces/kline.interface';

@Injectable()
export class VirtualTradingService {
  private readonly logger = new Logger(VirtualTradingService.name);
  private readonly positions: Map<string, Position> = new Map();
  private readonly closedPositions: Position[] = [];
  private readonly activeChannels: Map<string, SidewaysPattern> = new Map(); // Активные каналы
  private readonly takeProfitMultiplier: number;
  private readonly stopLossMultiplier: number;
  private readonly enabled: boolean;
  private readonly maxPositions: number;
  private readonly makerFeeRate: number;
  private readonly takerFeeRate: number;
  private virtualBalance: number = 10000; // Стартовый виртуальный баланс
  private dailyPnl: number = 0;
  private dailyStartBalance: number = 10000;
  private totalFeespaid: number = 0; // Общая сумма комиссий

  constructor(private configService: ConfigService) {
    this.takeProfitMultiplier = this.configService.get<number>('trading.takeProfitMultiplier', 1.05);
    this.stopLossMultiplier = this.configService.get<number>('trading.stopLossMultiplier', 0.95);
    this.enabled = this.configService.get<boolean>('trading.enabled', false);
    this.maxPositions = this.configService.get<number>('trading.maxPositions', 999);
    this.makerFeeRate = this.configService.get<number>('trading.fees.makerFeeRate', 0.0002);
    this.takerFeeRate = this.configService.get<number>('trading.fees.takerFeeRate', 0.0005);
    
    this.logger.log(`🎮 Виртуальная торговля инициализирована: ${this.enabled ? 'ВКЛЮЧЕНА' : 'ВЫКЛЮЧЕНА'}`);
    this.logger.log(`💰 Стартовый баланс: ${this.virtualBalance} USDT`);
    this.logger.log(`📊 Размер позиции: 1% от баланса, без лимита на количество позиций`);
    this.logger.log(`💸 Комиссии: Maker ${(this.makerFeeRate * 100).toFixed(3)}%, Taker ${(this.takerFeeRate * 100).toFixed(3)}%`);
  }

  // Обработка найденного боковика - сохранение канала для торговли
  async processPattern(pattern: SidewaysPattern, currentPrice: number): Promise<void> {
    if (!this.enabled) return;

    try {
      // Сохраняем канал как активный для торговли отскоков
      this.activeChannels.set(pattern.symbol, pattern);
      
      this.logger.log(
        `📊 АКТИВНЫЙ КАНАЛ ${pattern.symbol} | ` +
        `Диапазон: ${pattern.lowLevel.toFixed(6)} - ${pattern.highLevel.toFixed(6)} | ` +
        `Ширина: ${pattern.channelWidthPercent.toFixed(2)}%`
      );

      // Проверяем, можем ли мы сразу войти в сделку
      await this.checkForTradeEntry(pattern.symbol, currentPrice);
    } catch (error) {
      this.logger.error(`❌ Ошибка обработки паттерна ${pattern.symbol}: ${error.message}`);
    }
  }

  // Проверка возможности входа в сделку по активному каналу
  private async checkForTradeEntry(symbol: string, currentPrice: number): Promise<void> {
    const channel = this.activeChannels.get(symbol);
    if (!channel) return;

    // Проверяем, что цена достаточно близко к границе канала для входа
    if (this.isNearChannelBoundary(channel, currentPrice)) {
      const signal = this.createTradeSignal(channel, currentPrice);
      await this.executeSignal(signal, currentPrice);
    }
  }

  // Создание торгового сигнала на основе боковика
  private createTradeSignal(pattern: SidewaysPattern, currentPrice: number): TradeSignal {
    // Определяем направление сделки (отскок от уровня)
    const direction = this.getTradeDirection(pattern, currentPrice);
    
    // Высота канала
    const channelHeight = pattern.highLevel - pattern.lowLevel;
    
    let takeProfit: number;
    let stopLoss: number;
    
    if (direction === 'LONG') {
      // LONG от нижней границы: 
      // TP = к верхней границе с коэффициентом
      // SL = ниже нижней границы с коэффициентом
      const targetMove = channelHeight * this.takeProfitMultiplier;
      const stopMove = channelHeight * this.stopLossMultiplier;
      
      takeProfit = currentPrice + targetMove;
      stopLoss = currentPrice - stopMove;
    } else {
      // SHORT от верхней границы:
      // TP = к нижней границе с коэффициентом  
      // SL = выше верхней границы с коэффициентом
      const targetMove = channelHeight * this.takeProfitMultiplier;
      const stopMove = channelHeight * this.stopLossMultiplier;
      
      takeProfit = currentPrice - targetMove;
      stopLoss = currentPrice + stopMove;
    }

    return {
      symbol: pattern.symbol,
      action: direction === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
      price: currentPrice,
      timestamp: Date.now(),
      channelWidth: pattern.channelWidthPercent,
      reason: `Отскок от ${direction === 'LONG' ? 'нижней' : 'верхней'} границы боковика`,
      takeProfit,
      stopLoss,
    };
  }

  // Определение направления сделки на основе паттерна
  private getTradeDirection(pattern: SidewaysPattern, currentPrice: number): 'LONG' | 'SHORT' {
    // ПРАВИЛЬНАЯ ЛОГИКА: Торгуем отскоки от уровней боковика
    // Если цена у верхней границы - открываем SHORT (ожидаем отскок вниз)
    // Если цена у нижней границы - открываем LONG (ожидаем отскок вверх)
    
    const distanceToHigh = Math.abs(currentPrice - pattern.highLevel);
    const distanceToLow = Math.abs(currentPrice - pattern.lowLevel);
    
    if (distanceToHigh < distanceToLow) {
      return 'SHORT'; // Цена у верхней границы, ожидаем отскок вниз
    } else {
      return 'LONG'; // Цена у нижней границы, ожидаем отскок вверх
    }
  }

  // Проверка, находится ли цена достаточно близко к границе канала
  private isNearChannelBoundary(pattern: SidewaysPattern, currentPrice: number): boolean {
    const channelHeight = pattern.highLevel - pattern.lowLevel;
    const threshold = channelHeight * 0.05; // 5% от высоты канала (строже для 5m)
    
    // Проверяем близость к верхней или нижней границе
    const distanceToHigh = Math.abs(currentPrice - pattern.highLevel);
    const distanceToLow = Math.abs(currentPrice - pattern.lowLevel);
    
    return distanceToHigh <= threshold || distanceToLow <= threshold;
  }

  // Выполнение торгового сигнала
  private async executeSignal(signal: TradeSignal, currentPrice: number): Promise<void> {
    const existingPosition = this.positions.get(signal.symbol);

    if (existingPosition) {
      // Если есть позиция в том же направлении - игнорируем
      const currentDirection = existingPosition.side;
      const newDirection = signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT';
      
      if (currentDirection === newDirection) {
        this.logger.debug(`↩️ ${signal.symbol}: Уже есть позиция ${currentDirection}, игнорируем`);
        return;
      }

      // Разворот позиции
      await this.reversePosition(existingPosition, signal, currentPrice);
    } else {
      // Открываем новую позицию (без лимита на количество)
      await this.openPosition(signal, currentPrice);
    }
  }

  // Открытие новой позиции
  private async openPosition(signal: TradeSignal, currentPrice: number): Promise<void> {
    const positionSize = this.calculatePositionSize(signal);
    
    // Рассчитываем комиссию за открытие (как тейкер - market order)
    const openFee = positionSize * currentPrice * this.takerFeeRate;
    
    const position: Position = {
      id: this.generatePositionId(),
      symbol: signal.symbol,
      side: signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
      entryPrice: currentPrice,
      quantity: positionSize,
      entryTime: signal.timestamp,
      takeProfit: signal.takeProfit,
      stopLoss: signal.stopLoss,
      channelWidth: signal.channelWidth,
      status: 'OPEN',
    };

    this.positions.set(signal.symbol, position);

    // Вычитаем комиссию из баланса
    this.virtualBalance -= openFee;
    this.totalFeespaid += openFee;

    this.logger.log(
      `🚀 ОТКРЫТА ПОЗИЦИЯ ${position.side} ${signal.symbol} | ` +
      `Цена: ${currentPrice.toFixed(6)} | ` +
      `TP: ${signal.takeProfit.toFixed(6)} | ` +
      `SL: ${signal.stopLoss.toFixed(6)} | ` +
      `Канал: ${signal.channelWidth.toFixed(2)}% | ` +
      `Комиссия: ${openFee.toFixed(2)} USDT`
    );
  }

  // Разворот позиции
  private async reversePosition(existingPosition: Position, signal: TradeSignal, currentPrice: number): Promise<void> {
    // Закрываем текущую позицию
    await this.closePosition(existingPosition, currentPrice, 'REVERSE');
    
    // Открываем новую позицию в противоположном направлении
    await this.openPosition(signal, currentPrice);
    
    this.logger.log(`🔄 РАЗВОРОТ ${signal.symbol}: ${existingPosition.side} → ${signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT'}`);
  }

  // Проверка позиций на закрытие по свече + проверка новых входов
  async checkPositionsOnCandle(kline: KlineData): Promise<void> {
    if (!this.enabled) return;

    // Проверяем существующие позиции на закрытие
    await this.checkExistingPositions(kline);
    
    // Проверяем возможность новых входов по активным каналам
    await this.checkForTradeEntry(kline.symbol, parseFloat(kline.close));
  }

  // Проверка существующих позиций на закрытие
  private async checkExistingPositions(kline: KlineData): Promise<void> {
    const position = this.positions.get(kline.symbol);
    if (!position) return;

    const high = parseFloat(kline.high);
    const low = parseFloat(kline.low);
    const close = parseFloat(kline.close);

    // Проверяем тейк-профит
    if (
      (position.side === 'LONG' && high >= position.takeProfit) ||
      (position.side === 'SHORT' && low <= position.takeProfit)
    ) {
      await this.closePosition(position, position.takeProfit, 'TAKE_PROFIT');
      return;
    }

    // Проверяем стоп-лосс
    if (
      (position.side === 'LONG' && low <= position.stopLoss) ||
      (position.side === 'SHORT' && high >= position.stopLoss)
    ) {
      await this.closePosition(position, position.stopLoss, 'STOP_LOSS');
      return;
    }
  }

  // Закрытие позиции
  private async closePosition(
    position: Position, 
    closePrice: number, 
    reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'REVERSE' | 'MANUAL'
  ): Promise<void> {
    // Рассчитываем комиссию за закрытие (как тейкер - market order)
    const closeFee = position.quantity * closePrice * this.takerFeeRate;
    
    // Рассчитываем PnL до комиссий
    const grossPnl = this.calculatePnL(position, closePrice);
    
    // Итоговый PnL с учетом комиссии за закрытие
    const netPnl = grossPnl - closeFee;
    
    position.status = 'CLOSED';
    position.closePrice = closePrice;
    position.closeTime = Date.now();
    position.pnl = netPnl; // Сохраняем чистый PnL
    position.reason = reason;

    // Обновляем виртуальный баланс (PnL уже включает комиссию)
    this.virtualBalance += netPnl;
    this.dailyPnl += netPnl;
    this.totalFeespaid += closeFee;

    // Перемещаем в закрытые позиции
    this.closedPositions.push({ ...position });
    this.positions.delete(position.symbol);

    const emoji = netPnl > 0 ? '💚' : '❤️';
    const reasonEmoji = {
      'TAKE_PROFIT': '🎯',
      'STOP_LOSS': '⛔',
      'REVERSE': '🔄',
      'MANUAL': '👤'
    }[reason];

    this.logger.log(
      `${emoji} ЗАКРЫТА ПОЗИЦИЯ ${position.side} ${position.symbol} | ` +
      `${reasonEmoji} ${reason} | ` +
      `PnL: ${grossPnl.toFixed(2)} USDT | ` +
      `Комиссия: ${closeFee.toFixed(2)} USDT | ` +
      `Чистый PnL: ${netPnl.toFixed(2)} USDT | ` +
      `Баланс: ${this.virtualBalance.toFixed(2)} USDT`
    );
  }

  // Расчет PnL
  private calculatePnL(position: Position, closePrice: number): number {
    const priceDiff = closePrice - position.entryPrice;
    const multiplier = position.side === 'LONG' ? 1 : -1;
    return priceDiff * multiplier * position.quantity;
  }

  // Расчет размера позиции
  private calculatePositionSize(signal: TradeSignal): number {
    const positionSizePercent = this.configService.get<number>('trading.positionSizePercent', 1);
    const positionValue = (this.virtualBalance * positionSizePercent) / 100;
    return positionValue / signal.price;
  }

  // Генерация ID позиции
  private generatePositionId(): string {
    return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Получение статистики
  getTradingStats(): TradingStats {
    const totalTrades = this.closedPositions.length;
    const winningTrades = this.closedPositions.filter(p => (p.pnl || 0) > 0).length;
    const losingTrades = this.closedPositions.filter(p => (p.pnl || 0) < 0).length;
    const totalPnl = this.closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    
    const wins = this.closedPositions.filter(p => (p.pnl || 0) > 0);
    const losses = this.closedPositions.filter(p => (p.pnl || 0) < 0);
    
    const averageWin = wins.length > 0 ? wins.reduce((sum, p) => sum + (p.pnl || 0), 0) / wins.length : 0;
    const averageLoss = losses.length > 0 ? losses.reduce((sum, p) => sum + (p.pnl || 0), 0) / losses.length : 0;
    
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = Math.abs(averageLoss) > 0 ? averageWin / Math.abs(averageLoss) : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalPnl,
      winRate,
      averageWin,
      averageLoss,
      profitFactor,
      maxDrawdown: 0, // TODO: реализовать расчет максимальной просадки
      activePosсitions: this.positions.size,
    };
  }

  // Получение активных позиций
  getActivePositions(): Position[] {
    return Array.from(this.positions.values());
  }

  // Получение закрытых позиций
  getClosedPositions(): Position[] {
    return this.closedPositions;
  }

  // Получение виртуального баланса
  getVirtualBalance(): number {
    return this.virtualBalance;
  }

  // Сброс дневной статистики (можно вызывать в 00:00)
  resetDailyStats(): void {
    this.dailyPnl = 0;
    this.dailyStartBalance = this.virtualBalance;
  }

  // Получение дневной прибыли
  getDailyPnl(): number {
    return this.dailyPnl;
  }

  // Получение общей суммы комиссий
  getTotalFeesPaid(): number {
    return this.totalFeespaid;
  }

  // Получение детальной торговой статистики с комиссиями
  getDetailedTradingStats() {
    const stats = this.getTradingStats();
    const grossPnl = stats.totalPnl + this.totalFeespaid; // PnL до комиссий
    
    return {
      ...stats,
      balance: this.virtualBalance,
      grossPnl: grossPnl,
      netPnl: stats.totalPnl,
      totalFees: this.totalFeespaid,
      dailyPnl: this.dailyPnl,
      dailyROI: this.dailyStartBalance > 0 ? (this.dailyPnl / this.dailyStartBalance) * 100 : 0,
      totalROI: ((this.virtualBalance - 10000) / 10000) * 100,
    };
  }
}
