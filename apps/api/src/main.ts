import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigValidationError, loadConfig } from './config/load-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config));
  app.enableShutdownHooks();
  // The web app calls the API straight from the browser (no Next.js proxy:
  // answers can take a minute and uploads can be 50 MB).
  app.enableCors({ origin: config.WEB_ORIGIN });
  await app.listen(config.API_PORT);
  Logger.log(`API listening on port ${config.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    Logger.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
      'Bootstrap',
    );
  }
  process.exit(1);
});
