import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import { PrismaClient } from '../../generated/prisma/client';

/** The API's only database client. Boot fails if Postgres is unreachable. */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const [{ version, pgvector }] = await this.$queryRaw<
      { version: string; pgvector: string | null }[]
    >`SELECT current_setting('server_version') AS version,
             (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector`;
    this.logger.log(
      `Connected to Postgres ${version} (pgvector ${pgvector ?? 'not installed — run migrations'})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
