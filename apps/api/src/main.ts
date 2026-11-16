import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger';
import { REQUEST_ID_HEADER } from './common/request-context';
import { requestIdMiddleware } from './common/request-id.middleware';
import { ConfigValidationError, loadConfig } from './config/load-config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  // JSON lines with the request id (ADR 0020); the logger is set before
  // modules boot so their start-up lines are JSON too.
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: new JsonLogger(),
  });
  app.use(requestIdMiddleware);
  app.enableShutdownHooks();
  // The web app calls the API straight from the browser (no Next.js proxy:
  // answers can take a minute and uploads can be 50 MB).
  app.enableCors({
    origin: config.WEB_ORIGIN,
    // Lets the browser read the id, so a UI error can be matched to the logs.
    exposedHeaders: [REQUEST_ID_HEADER],
  });
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
