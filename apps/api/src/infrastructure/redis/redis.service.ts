import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

/** Owns the Redis client. Boot fails if Redis is unreachable. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 5_000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      await this.client.ping();
    } catch (error) {
      // Stop ioredis from retrying in the background so the process can exit.
      this.client.disconnect();
      throw error;
    }
    const info = await this.client.info('server');
    const version = /redis_version:(\S+)/.exec(info)?.[1] ?? 'unknown';
    this.logger.log(`Connected to Redis ${version}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
