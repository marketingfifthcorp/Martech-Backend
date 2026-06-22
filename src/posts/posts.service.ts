import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePostDto } from './dto/update-post.dto';
import { CalendarAgentService, ImprovableField } from '../ai/calendar-agent.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private calendarAgent: CalendarAgentService,
    private notifications: NotificationsService,
  ) {}

  async findByProject(projectId: string) {
    return this.prisma.post.findMany({
      where: { projectId },
      include: {
        assets: { where: { isCurrent: true } },
        approvals: { include: { user: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        publishLog: true,
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async findByClient(clientId: string) {
    return this.prisma.post.findMany({
      where: { project: { clientId } },
      include: {
        assets: { where: { isCurrent: true } },
        approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
        project: { select: { id: true, clientId: true, month: true, year: true, title: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  async findOne(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        assets: { orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }] },
        approvals: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        publishLog: true,
        project: { include: { client: true, strategy: true } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async update(id: string, dto: UpdatePostDto) {
    return this.prisma.post.update({
      where: { id },
      data: {
        ...dto,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        status: dto.status as any,
      },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.post.update({
      where: { id },
      data: { status: status as any },
    });
  }

  /** Designer explicitly submits uploaded creative for admin review */
  async markCreativeUploaded(id: string) {
    const post = await this.prisma.post.update({
      where: { id },
      data: { status: 'AWAITING_APPROVAL' },
      include: { project: { include: { client: true } } },
    });

    await this.notifications.notifyAdmins({
      type: 'approval_needed',
      title: 'Creative Submitted',
      message: `New creative ready for "${post.topic ?? id}" — awaiting approval`,
      link: `/post-review?postId=${id}`,
    });

    return post;
  }

  /** Client approves or requests changes on a post */
  async submitApproval(
    postId: string,
    userId: string,
    action: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED',
    comment?: string,
  ) {
    await this.prisma.approval.create({
      data: { type: 'POST_CREATIVE', postId, userId, action, comment },
    });

    const newStatus =
      action === 'APPROVED'
        ? 'APPROVED'
        : action === 'CHANGES_REQUESTED'
        ? 'REVISION_REQUIRED'
        : 'REVISION_REQUIRED';

    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { status: newStatus as any },
      include: { project: { include: { client: true } } },
    });

    const clientName = (post.project as any).client?.name ?? 'Client';
    const postLink   = `/post-review?postId=${postId}`;

    if (action === 'APPROVED') {
      const pendingCount = await this.prisma.post.count({
        where: {
          projectId: post.projectId,
          status: { notIn: ['APPROVED', 'SCHEDULED', 'PUBLISHED', 'PUBLISHING'] },
        },
      });
      if (pendingCount === 0) {
        await this.prisma.project.update({
          where: { id: post.projectId },
          data: { status: 'APPROVED' },
        });
        await this.notifications.notifyAdmins({
          type: 'post_approved',
          title: 'All Posts Approved',
          message: `${clientName} approved all posts — project ready to queue`,
          link: `/projects/${post.projectId}`,
        });
      } else {
        await this.notifications.notifyAdmins({
          type: 'post_approved',
          title: 'Post Approved',
          message: `${clientName} approved a post: "${post.topic ?? ''}"`,
          link: postLink,
        });
      }
    } else {
      await this.notifications.notifyAdmins({
        type: 'revision_requested',
        title: 'Revision Requested',
        message: `${clientName} requested changes${comment ? `: "${comment.slice(0, 60)}"` : ''}`,
        link: postLink,
      });
    }

    return { success: true, action, postId };
  }

  /** Generate full caption for a single post and save it */
  async expandCaption(postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { project: { include: { client: true, strategy: true } } },
    });
    if (!post) throw new NotFoundException('Post not found');

    const strategy = post.project?.strategy;
    const client   = post.project?.client;

    const result = await this.calendarAgent.expandCaption({
      clientName:        client?.name        ?? '',
      platform:          post.platform,
      format:            post.format         ?? 'post',
      pillar:            (post as any).pillar ?? '',
      topic:             post.topic          ?? '',
      hook:              post.hook           ?? '',
      toneRecommendation: strategy?.toneRecommendation ?? '',
      messagingDirection: strategy?.messagingDirection ?? '',
      keyMessages:        (strategy?.keyMessages as string[]) ?? [],
    });

    return this.prisma.post.update({
      where: { id: postId },
      data: {
        caption:  result.caption,
        hashtags: result.hashtags,
        cta:      result.cta,
      },
    });
  }

  async getApprovalQueue(clientId: string) {
    return this.prisma.post.findMany({
      where: {
        project: { clientId },
        status: { in: ['AWAITING_APPROVAL', 'REVISION_REQUIRED'] },
      },
      include: {
        assets: { where: { isCurrent: true } },
        project: { select: { month: true, year: true, title: true } },
      },
      orderBy: { scheduledDate: 'asc' },
    });
  }

  /** Returns an AI-generated suggestion for a single field. Does NOT save. */
  async improveField(postId: string, field: string, instruction: string) {
    const ALLOWED: ImprovableField[] = ['hook', 'caption', 'cta', 'hashtags', 'creativeNote'];
    if (!ALLOWED.includes(field as ImprovableField)) {
      throw new BadRequestException(`Field "${field}" is not improvable`);
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { project: { include: { client: true, strategy: true } } },
    });
    if (!post) throw new NotFoundException('Post not found');

    const strategy = post.project?.strategy;
    const client   = post.project?.client;
    const rawValue = (post as any)[field];
    const currentValue = field === 'hashtags'
      ? (Array.isArray(rawValue) ? rawValue : [])
      : (rawValue ?? '');

    return this.calendarAgent.improveField({
      field:              field as ImprovableField,
      currentValue,
      instruction:        instruction || '',
      clientName:         client?.name ?? '',
      platform:           post.platform,
      format:             post.format ?? 'post',
      topic:              post.topic  ?? '',
      pillar:             (post as any).pillar ?? '',
      hook:               post.hook   ?? '',
      caption:            post.caption ?? '',
      toneRecommendation: strategy?.toneRecommendation ?? '',
      messagingDirection: strategy?.messagingDirection ?? '',
      keyMessages:        (strategy?.keyMessages as string[]) ?? [],
    });
  }
}
