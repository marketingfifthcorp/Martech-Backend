import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';

@Injectable()
export class AnalyticsCron {
  private readonly logger = new Logger(AnalyticsCron.name);

  constructor(private analytics: AnalyticsService) {}

  /** Runs daily at midnight — snapshots followers_count for every active Instagram account */
  @Cron('0 0 * * *')
  async handleFollowerSnapshot() {
    try {
      const results = await this.analytics.seedFollowerSnapshot();
      this.logger.log(`Follower snapshot cron: saved ${results.length} snapshot(s)`);
    } catch (e: any) {
      this.logger.warn(`Follower snapshot cron error: ${e.message}`);
    }
  }
}
