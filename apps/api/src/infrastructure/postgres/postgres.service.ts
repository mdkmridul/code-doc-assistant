import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';

/** Owns the Postgres connection pool. Boot fails if the database is unreachable. */
@Injectable()
export class PostgresService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostgresService.name);
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{
      version: string;
      pgvector: string | null;
    }>(
      `SELECT current_setting('server_version') AS version,
              (SELECT default_version FROM pg_available_extensions WHERE name = 'vector') AS pgvector`,
    );
    const { version, pgvector } = rows[0];
    this.logger.log(
      `Connected to Postgres ${version} (pgvector ${pgvector ?? 'not available'})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
