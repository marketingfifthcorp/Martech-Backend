import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const GRAPH = 'https://graph.facebook.com/v23.0';

type Period = '15d' | '30d' | '60d' | '90d';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  async getAnalytics(clientId: string, period: Period = '30d') {
    const days = parseInt(period); // '30d' → 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().split('T')[0]; // "YYYY-MM-DD"

    // ─── Tier 1: DB-derived (always succeeds) ─────────────────

    const publishedPosts = await this.prisma.post.findMany({
      where: {
        project: { clientId },
        status: 'PUBLISHED',
        publishedAt: { gte: since },
      },
      select: { platform: true, format: true, publishedAt: true },
    });

    // Group by platform
    const platformMap: Record<string, number> = {};
    for (const p of publishedPosts) {
      platformMap[p.platform] = (platformMap[p.platform] ?? 0) + 1;
    }
    const postsByPlatform = Object.entries(platformMap)
      .map(([platform, count]) => ({ platform, count }))
      .sort((a, b) => b.count - a.count);

    // Group by format
    const formatMap: Record<string, number> = {};
    for (const p of publishedPosts) {
      if (p.format) formatMap[p.format] = (formatMap[p.format] ?? 0) + 1;
    }
    const postsByFormat = Object.entries(formatMap)
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count);

    // Publish success rate
    const publishLogs = await this.prisma.publishLog.findMany({
      where: {
        post: { project: { clientId } },
        status: { in: ['PUBLISHED', 'FAILED'] },
        scheduledAt: { gte: since },
      },
      select: { status: true },
    });
    const published = publishLogs.filter((l) => l.status === 'PUBLISHED').length;
    const failed = publishLogs.filter((l) => l.status === 'FAILED').length;
    const publishSuccessRate =
      published + failed === 0 ? 100 : Math.round((published / (published + failed)) * 100);

    // Timeline: posts published per day (used for chart)
    const dayMap: Record<string, number> = {};
    for (const p of publishedPosts) {
      if (p.publishedAt) {
        const day = p.publishedAt.toISOString().split('T')[0];
        dayMap[day] = (dayMap[day] ?? 0) + 1;
      }
    }
    const timeline = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));

    // Followers gained from snapshots (returns null if < 2 snapshots in period)
    const snapshots = await this.prisma.instagramFollowerSnapshot.findMany({
      where: { clientId, date: { gte: sinceStr } },
      orderBy: { date: 'asc' },
    });
    const followersGained =
      snapshots.length >= 2
        ? snapshots[snapshots.length - 1].followerCount - snapshots[0].followerCount
        : null;

    // ─── Tier 2: Instagram API (each field independently null-safe) ──

    let totalReach: number | null = null;
    let engagementRate: number | null = null;

    const igConn = await this.prisma.platformConnection.findFirst({
      where: { clientId, platform: 'instagram', isActive: true },
    });

    if (igConn?.accessToken && igConn.accountId) {
      const { accessToken: token, accountId: igUserId } = igConn;
      totalReach = await this.fetchReach(token, igUserId, since);
      engagementRate = await this.fetchEngagementRate(token, igUserId);
    }

    return {
      postsPublished: publishedPosts.length,
      postsByPlatform,
      postsByFormat,
      publishSuccessRate,
      timeline,
      totalReach,
      followersGained,
      engagementRate,
    };
  }

  // ─── Instagram Insights helpers ────────────────────────────────

  private async fetchReach(token: string, igUserId: string, since: Date): Promise<number | null> {
    try {
      const sinceUnix = Math.floor(since.getTime() / 1000);
      const untilUnix = Math.floor(Date.now() / 1000);
      const res = await fetch(
        `${GRAPH}/${igUserId}/insights?metric=reach&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${token}`,
      );
      const data = await res.json() as any;
      if (!res.ok || data.error) {
        this.logger.warn(`[analytics] reach failed: ${data.error?.message ?? JSON.stringify(data)}`);
        return null;
      }
      const values: { value: number }[] = data.data?.[0]?.values ?? [];
      return values.reduce((sum, v) => sum + (v.value ?? 0), 0);
    } catch (e: any) {
      this.logger.warn(`[analytics] reach error: ${e.message}`);
      return null;
    }
  }

  private async fetchEngagementRate(token: string, igUserId: string): Promise<number | null> {
    try {
      // Cap to 15 most-recent posts — calling /{media-id}/insights for every post in
      // the period would burn through the 200-calls/hr Graph API rate limit quickly.
      const mediaRes = await fetch(
        `${GRAPH}/${igUserId}/media?fields=id,like_count,comments_count&limit=15&access_token=${token}`,
      );
      const mediaData = await mediaRes.json() as any;
      if (!mediaRes.ok || mediaData.error) {
        this.logger.warn(`[analytics] media fetch failed: ${mediaData.error?.message ?? JSON.stringify(mediaData)}`);
        return null;
      }

      const posts: { like_count: number; comments_count: number }[] = mediaData.data ?? [];
      if (posts.length === 0) return null;

      const profileRes = await fetch(
        `${GRAPH}/${igUserId}?fields=followers_count&access_token=${token}`,
      );
      const profileData = await profileRes.json() as any;
      if (!profileRes.ok || profileData.error) {
        this.logger.warn(`[analytics] profile fetch failed: ${profileData.error?.message ?? JSON.stringify(profileData)}`);
        return null;
      }

      const followers = profileData.followers_count ?? 0;
      if (followers === 0) return null;

      const totalEng = posts.reduce(
        (sum, p) => sum + (p.like_count ?? 0) + (p.comments_count ?? 0),
        0,
      );
      return parseFloat(((totalEng / posts.length / followers) * 100).toFixed(2));
    } catch (e: any) {
      this.logger.warn(`[analytics] engagement rate error: ${e.message}`);
      return null;
    }
  }

  // ─── Follower snapshot (called by cron + seed endpoint) ────────

  async seedFollowerSnapshot(): Promise<{ clientId: string; date: string; followerCount: number }[]> {
    const connections = await this.prisma.platformConnection.findMany({
      where: { platform: 'instagram', isActive: true },
    });

    const today = new Date().toISOString().split('T')[0];
    const results: { clientId: string; date: string; followerCount: number }[] = [];

    for (const conn of connections) {
      if (!conn.accessToken || !conn.accountId) continue;
      try {
        const res = await fetch(
          `${GRAPH}/${conn.accountId}?fields=followers_count&access_token=${conn.accessToken}`,
        );
        const data = await res.json() as any;
        if (!res.ok || data.error) {
          this.logger.warn(`[analytics] follower snapshot failed for client ${conn.clientId}: ${data.error?.message}`);
          continue;
        }
        const followerCount: number = data.followers_count ?? 0;
        await this.prisma.instagramFollowerSnapshot.upsert({
          where: { clientId_date: { clientId: conn.clientId, date: today } },
          update: { followerCount },
          create: { clientId: conn.clientId, date: today, followerCount },
        });
        results.push({ clientId: conn.clientId, date: today, followerCount });
        this.logger.log(`[analytics] snapshot saved for client ${conn.clientId}: ${followerCount} followers`);
      } catch (e: any) {
        this.logger.warn(`[analytics] snapshot error for client ${conn.clientId}: ${e.message}`);
      }
    }
    return results;
  }
}
