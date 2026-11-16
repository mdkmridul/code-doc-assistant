import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { SearchModule } from './search/search.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        PrismaModule,
        RedisModule,
        BullModule.forRoot({ connection: { url: config.REDIS_URL } }),
        IngestionModule,
        SearchModule.forRoot(config),
      ],
      controllers: [AppController],
      providers: [AppService],
    };
  }
}
