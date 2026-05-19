import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MetaPublisher } from './publishers/meta.publisher';
import { LinkedInPublisher } from './publishers/linkedin.publisher';
import { TikTokPublisher } from './publishers/tiktok.publisher';
import { XPublisher } from './publishers/x.publisher';
import { PostPayload } from './publishers/publisher.types';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  private readonly publishers = {
    instagram: new MetaPublisher(),
    linkedin:  new LinkedInPublisher(),
    tiktok:    new TikTokPublisher(),
    x:         new XPublisher(),
  } as const;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** Move all approved posts for a project into the publishing queue */
  async queueProjectPosts(projectId: string) {
    const posts = await this.prisma.post.findMany({
      where: { projectId, status: 'APPROVED' },
    });
    if (posts.length === 0) throw new BadRequestException('No approved posts to queue');

    const queued = await Promise.all(
      posts.map(async (post) => {
        await this.prisma.post.update({ where: { id: post.id }, data: { status: 'SCHEDULED' } });
        return this.prisma.publishLog.upsert({
          where: { postId: post.id },
          update: { status: 'SCHEDULED', scheduledAt: post.scheduledDate },
          create: {
            postId: post.id,
            platform: post.platform,
            scheduledAt: post.scheduledDate,
            status: 'SCHEDULED',
          },
        });
      }),
    );
    return { queued: queued.length, message: `${queued.length} posts queued for publishing` };
  }

  /** Get publishing queue */
  async getQueue(clientId?: string) {
    return this.prisma.publishLog.findMany({
      where: {
        status: { in: ['SCHEDULED', 'PUBLISHING', 'FAILED'] },
        post: clientId ? { project: { clientId } } : undefined,
      },
      include: {
        post: {
          include: {
            assets: { where: { isCurrent: true } },
            project: { select: { title: true, client: { select: { name: true } } } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** Get published posts */
  async getPublishedLog(clientId?: string) {
    return this.prisma.publishLog.findMany({
      where: {
        status: 'PUBLISHED',
        post: clientId ? { project: { clientId } } : undefined,
      },
      include: {
        post: { include: { project: { select: { title: true } } } },
      },
      orderBy: { publishedAt: 'desc' },
    });
  }

  /** Publish a single post — calls real platform API if connection exists */
  async publishPost(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        assets: { where: { isCurrent: true } },
        publishLog: true,
        project: {
          include: {
            client: {
              include: { platformConnections: true },
            },
          },
        },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== 'SCHEDULED') {
      throw new BadRequestException('Post must be in SCHEDULED status to publish');
    }

    await this.prisma.post.update({ where: { id: postId }, data: { status: 'PUBLISHING' } });
    await this.prisma.publishLog.update({ where: { postId }, data: { status: 'PUBLISHING' } });

    const now = new Date();
    const clientId = post.project.clientId;
    const connection = post.project.client.platformConnections.find(
      (c) => c.platform === post.platform && c.isActive,
    );

    try {
      let platformPostId = `sim-${postId}`;
      let liveUrl = `https://placeholder.link/${postId}`;

      if (connection) {
        // Real publish via platform API
        const publisher = this.publishers[post.platform as keyof typeof this.publishers];
        if (!publisher) throw new Error(`No publisher implemented for platform: ${post.platform}`);

        const currentAsset = post.assets[0];
        const payload: PostPayload = {
          caption:     post.caption  || '',
          hashtags:    post.hashtags || [],
          assetUrl:    currentAsset?.fileUrl,
          assetType:   currentAsset?.fileType === 'video' ? 'video' : 'image',
          topic:       post.topic   || undefined,
          cta:         post.cta     || undefined,
        };

        const result = await publisher.publish(payload, {
          accessToken:  connection.accessToken!,
          refreshToken: connection.refreshToken ?? undefined,
          accountId:    connection.accountId    ?? undefined,
          accountName:  connection.accountName  ?? undefined,
        });

        platformPostId = result.platformPostId;
        liveUrl        = result.liveUrl;
      } else {
        this.logger.warn(
          `No ${post.platform} connection for client ${clientId} — simulating publish for post ${postId}`,
        );
      }

      // Mark success
      await this.prisma.post.update({
        where: { id: postId },
        data: { status: 'PUBLISHED', publishedAt: now },
      });
      const log = await this.prisma.publishLog.update({
        where: { postId },
        data: { status: 'PUBLISHED', publishedAt: now, platformPostId, liveUrl },
      });

      // Notify admin
      await this.notifyAdmins(clientId, post.platform, post.topic || 'Post', liveUrl);

      return log;
    } catch (e: any) {
      // Mark failure
      await this.prisma.post.update({ where: { id: postId }, data: { status: 'FAILED' } });
      await this.prisma.publishLog.update({
        where: { postId },
        data: { status: 'FAILED', errorMessage: e.message },
      });
      throw e;
    }
  }

  async retryFailed(postId: string) {
    const log = await this.prisma.publishLog.findUnique({ where: { postId } });
    if (!log) throw new NotFoundException('Publish log not found');
    await this.prisma.publishLog.update({
      where: { postId },
      data: { status: 'SCHEDULED', retryCount: log.retryCount + 1, errorMessage: null },
    });
    await this.prisma.post.update({ where: { id: postId }, data: { status: 'SCHEDULED' } });
    return { success: true, retryCount: log.retryCount + 1 };
  }

  private async notifyAdmins(clientId: string, platform: string, topic: string, liveUrl: string) {
    try {
      const client = await this.prisma.client.findUnique({
        where: { id: clientId },
        select: { adminId: true, name: true },
      });
      if (!client) return;

      await this.notifications.create({
        userId: client.adminId,
        type: 'published',
        title: 'Post Published',
        message: `"${topic}" was published to ${platform} for ${client.name}`,
        link: liveUrl,
      });
    } catch (e: any) {
      this.logger.warn(`Failed to create publish notification: ${e.message}`);
    }
  }
}
