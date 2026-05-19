import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PublishingService } from './publishing.service';

@Injectable()
export class PublishingCron {
  private readonly logger = new Logger(PublishingCron.name);

  constructor(
    private prisma: PrismaService,
    private publishing: PublishingService,
  ) {}

  /** Runs every minute — finds scheduled posts whose time has come and publishes them */
  @Cron('* * * * *')
  async handleScheduledPosts() {
    try {
      const due = await this.prisma.publishLog.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: new Date() },
        },
        select: { postId: true },
      });

      if (due.length === 0) return;
      this.logger.log(`Auto-publish: ${due.length} post(s) due`);

      for (const { postId } of due) {
        try {
          await this.publishing.publishPost(postId);
          this.logger.log(`Published post ${postId}`);
        } catch (e: any) {
          this.logger.warn(`Auto-publish failed for post ${postId}: ${e.message}`);
        }
      }
    } catch (e: any) {
      // P1001 = DB unreachable (common during Supabase connection drops) — suppress noisy log
      if (e?.code === 'P1001') {
        this.logger.debug('Auto-publish cron skipped: DB unreachable');
      } else {
        this.logger.warn(`Auto-publish cron error: ${e.message}`);
      }
    }
  }
}
