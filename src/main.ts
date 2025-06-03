import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// Полифилл для crypto объекта
if (typeof globalThis.crypto === 'undefined') {
  const { webcrypto } = require('crypto');
  globalThis.crypto = webcrypto;
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['log', 'error', 'warn'], // Убрали debug и verbose
    });

    // Настройка CORS если нужно
    app.enableCors();

    const port = process.env.PORT || 3005;
    await app.listen(port);

    logger.log(`Приложение запущено на http://localhost:${port}`);
    logger.log('Анализатор криптовалютных боковиков готов к работе');
  } catch (error) {
    logger.error('Ошибка запуска приложения:', error);
    process.exit(1);
  }
}

bootstrap();
