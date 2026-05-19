import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StrategyAgentService } from '../ai/strategy-agent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GenerateStrategyDto, UpdateStrategyDto } from './dto/create-strategy.dto';

@Injectable()
export class StrategyService {
  constructor(
    private prisma: PrismaService,
    private strategyAgent: StrategyAgentService,
    private notifications: NotificationsService,
  ) {}

  async generate(dto: GenerateStrategyDto) {
    const brief = await this.prisma.brief.findUnique({
      where: { id: dto.briefId },
      include: { client: true },
    });
    if (!brief) throw new NotFoundException('Brief not found');

    const strategy = await this.prisma.strategy.create({
      data: { briefId: dto.briefId, status: 'GENERATING' },
    });

    await this.prisma.client.update({
      where: { id: brief.clientId },
      data: { status: 'STRATEGY_PENDING' },
    });

    try {
      const output = await this.strategyAgent.generate({
        clientName: brief.client.name,
        brand: brief.client.brand,
        industry: brief.client.industry,
        platforms: brief.client.platforms,
        postingFrequency: brief.client.postingFrequency,
        websiteUrl: brief.websiteUrl || brief.client.websiteUrl,
        socialLinks: brief.socialLinks,
        campaignGoals: brief.campaignGoals,
        targetAudience: brief.targetAudience,
        competitorNotes: brief.competitorNotes,
        toneOfVoice: brief.toneOfVoice,
        sector: brief.sector || brief.client.industry,
        adminNotes: brief.adminNotes,
      });

      const updated = await this.prisma.strategy.update({
        where: { id: strategy.id },
        data: {
          summary: output.summary,
          contentPillars: output.contentPillars as any,
          targetAudience: output.targetAudience as any,
          messagingDirection: output.messagingDirection,
          toneRecommendation: output.toneRecommendation,
          platformStrategy: output.platformStrategy as any,
          keyMessages: output.keyMessages,
          rawOutput: output as any,
          status: 'INTERNAL_REVIEW',
        },
      });

      await this.prisma.client.update({
        where: { id: brief.clientId },
        data: { status: 'STRATEGY_IN_REVIEW' },
      });

      await this.notifications.notifyAdmins({
        type: 'strategy_ready',
        title: 'Strategy Generated',
        message: `Strategy for ${brief.client.name} is ready for internal review`,
        link: `/strategy?clientId=${brief.clientId}`,
      });

      return updated;
    } catch (err) {
      await this.prisma.strategy.update({
        where: { id: strategy.id },
        data: { status: 'DRAFT' },
      });
      throw err;
    }
  }

  async findByBrief(briefId: string) {
    return this.prisma.strategy.findMany({
      where: { briefId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByClient(clientId: string) {
    return this.prisma.strategy.findMany({
      where: { brief: { clientId } },
      include: {
        brief: { select: { clientId: true } },
        approvals: {
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.strategy.findUnique({
      where: { id },
      include: {
        approvals: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        brief: { include: { client: true } },
        projects: true,
      },
    });
    if (!s) throw new NotFoundException('Strategy not found');
    return s;
  }

  async update(id: string, dto: UpdateStrategyDto) {
    await this.prisma.strategy.update({ where: { id }, data: dto as any });
    return this.findOne(id);
  }

  async sendToClient(id: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: { brief: { include: { client: true } } },
    });
    if (!strategy) throw new NotFoundException('Strategy not found');
    if (strategy.status === 'APPROVED') throw new BadRequestException('Strategy already approved');

    const updated = await this.prisma.strategy.update({
      where: { id },
      data: { status: 'SENT_TO_CLIENT', sentAt: new Date() },
    });

    await this.prisma.client.update({
      where: { id: strategy.brief.clientId },
      data: { status: 'STRATEGY_SENT' },
    });

    // Notify the client portal user
    const clientUserId = strategy.brief.client.clientUserId;
    await this.notifications.notifyUser(clientUserId, {
      type: 'strategy_ready',
      title: 'Your Strategy is Ready',
      message: `Your marketing strategy is ready for review. Please log in to approve or request changes.`,
      link: '/client-portal',
    });

    // Notify admins
    await this.notifications.notifyAdmins({
      type: 'strategy_ready',
      title: 'Strategy Sent to Client',
      message: `Strategy for ${strategy.brief.client.name} sent — awaiting client approval`,
      link: `/strategy?clientId=${strategy.brief.clientId}`,
    });

    return updated;
  }

  async resend(id: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: { brief: { include: { client: true } } },
    });
    if (!strategy) throw new NotFoundException('Strategy not found');

    const updated = await this.prisma.strategy.update({
      where: { id },
      data: { status: 'SENT_TO_CLIENT' },
    });

    await this.prisma.client.update({
      where: { id: strategy.brief.clientId },
      data: { status: 'STRATEGY_SENT' },
    });

    await this.notifications.notifyUser(strategy.brief.client.clientUserId, {
      type: 'strategy_ready',
      title: 'Updated Strategy Ready',
      message: `Your updated strategy is ready for review.`,
      link: '/client-portal',
    });

    return updated;
  }

  async submitApproval(
    strategyId: string,
    userId: string,
    action: 'APPROVED' | 'CHANGES_REQUESTED',
    comment?: string,
  ) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      include: { brief: { include: { client: true } } },
    });
    if (!strategy) throw new NotFoundException('Strategy not found');

    await this.prisma.approval.create({
      data: { type: 'STRATEGY', strategyId, userId, action, comment },
    });

    const clientName = strategy.brief.client.name;
    const clientId   = strategy.brief.clientId;

    if (action === 'APPROVED') {
      await this.prisma.strategy.update({
        where: { id: strategyId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      await this.prisma.client.update({
        where: { id: clientId },
        data: { status: 'STRATEGY_APPROVED' },
      });
      await this.notifications.notifyAdmins({
        type: 'post_approved',
        title: 'Strategy Approved',
        message: `${clientName} approved the marketing strategy — ready to create campaigns`,
        link: `/clients/${clientId}`,
      });
    } else {
      await this.prisma.strategy.update({
        where: { id: strategyId },
        data: { status: 'CHANGES_REQUESTED' },
      });
      await this.notifications.notifyAdmins({
        type: 'revision_requested',
        title: 'Strategy Changes Requested',
        message: `${clientName} requested changes${comment ? `: "${comment.slice(0, 60)}"` : ''}`,
        link: `/strategy?clientId=${clientId}`,
      });
    }

    return { success: true, action };
  }
}
