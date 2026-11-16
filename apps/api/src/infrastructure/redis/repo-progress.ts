import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { RepoProgress, RepoProgressPublisher } from '@cda/domain';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/env.schema';
import { RedisService } from './redis.service';

/** One pub/sub channel per repo. */
export const repoProgressChannel = (repoId: string) =>
  `repo-progress:${repoId}`;

/** Publishes ingest progress on Redis, so any API instance can stream it. */
@Injectable()
export class RedisProgressPublisher implements RepoProgressPublisher {
  private readonly logger = new Logger(RedisProgressPublisher.name);

  constructor(private readonly redis: RedisService) {}

  async publish(progress: RepoProgress): Promise<void> {
    try {
      await this.redis.client.publish(
        repoProgressChannel(progress.repoId),
        JSON.stringify(progress),
      );
    } catch (error) {
      this.logger.warn(
        `Could not publish progress for ${progress.repoId}: ${String(error)}`,
      );
      throw error;
    }
  }
}

export type ProgressListener = (progress: RepoProgress) => void;

/**
 * Fans repo progress out to in-process listeners (open SSE streams) over ONE
 * Redis subscriber connection. A channel is subscribed while it has at least
 * one listener and unsubscribed when its last listener leaves, so closed
 * streams leave nothing behind in Redis.
 */
@Injectable()
export class RepoProgressHub implements OnModuleDestroy {
  private readonly logger = new Logger(RepoProgressHub.name);
  private readonly listeners = new Map<string, Set<ProgressListener>>();
  private subscriber: Redis | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Starts delivering the repo's progress to `listener`; call the returned function to stop. */
  async subscribe(
    repoId: string,
    listener: ProgressListener,
  ): Promise<() => Promise<void>> {
    const channel = repoProgressChannel(repoId);
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set();
      this.listeners.set(channel, channelListeners);
      await this.connection().subscribe(channel);
    }
    channelListeners.add(listener);

    let unsubscribed = false;
    return async () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const current = this.listeners.get(channel);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(channel);
        await this.connection().unsubscribe(channel);
      }
    };
  }

  /** Channels with listeners right now (for diagnostics and tests). */
  activeChannels(): string[] {
    return [...this.listeners.keys()];
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  /** A subscribing connection can't run other commands, so it is separate from RedisService. */
  private connection(): Redis {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.config.REDIS_URL);
      this.subscriber.on('message', (channel: string, message: string) => {
        let progress: RepoProgress;
        try {
          progress = JSON.parse(message) as RepoProgress;
        } catch {
          this.logger.warn(`Ignoring malformed progress on ${channel}`);
          return;
        }
        for (const listener of this.listeners.get(channel) ?? []) {
          listener(progress);
        }
      });
    }
    return this.subscriber;
  }
}
