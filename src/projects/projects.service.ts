import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarAgentService } from '../ai/calendar-agent.service';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private calendarAgent: CalendarAgentService,
  ) {}

  async create(data: {
    clientId: string;
    strategyId?: string;
    title: string;
    month: number;
    year: number;
  }) {
    const existing = await this.prisma.project.findUnique({
      where: { clientId_month_year: { clientId: data.clientId, month: data.month, year: data.year } },
    });
    if (existing) {
      throw new ConflictException(
        `A campaign for this month already exists. Open it from the campaigns list.`,
      );
    }
    return this.prisma.project.create({ data });
  }

  async findByClient(clientId: string) {
    return this.prisma.project.findMany({
      where: { clientId },
      include: {
        posts: {
          select: {
            id: true, platform: true, format: true,
            scheduledDate: true, status: true,
            assets: { where: { isCurrent: true }, take: 1 },
          },
          orderBy: { scheduledDate: 'asc' },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        client: true,
        strategy: true,
        posts: {
          include: {
            assets: { where: { isCurrent: true } },
            approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          orderBy: { scheduledDate: 'asc' },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /**
   * Admin triggers calendar generation for this project
   */
  async generateCalendar(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        strategy: true,
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.strategy) throw new NotFoundException('Project has no linked strategy');

    await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'CALENDAR_GENERATING' },
    });

    const strategy = project.strategy;

    try {
      // Cap frequency to avoid blowing the token budget; default to 12 if unset
      const postingFrequency = Math.min(project.client.postingFrequency || 12, 30);

      // Normalise platformStrategy — stored as either object or array
      const rawPS = (strategy.platformStrategy as any) || {};
      const platformStrategy: Record<string, any> = Array.isArray(rawPS)
        ? Object.fromEntries(rawPS.map((p: any) => [p.platform ?? p.name, p]))
        : rawPS;

      const posts = await this.calendarAgent.generate({
        clientName: project.client.name,
        month: project.month,
        year: project.year,
        platforms: project.client.platforms,
        postingFrequency,
        contentPillars: (strategy.contentPillars as any[]) || [],
        messagingDirection: strategy.messagingDirection || '',
        toneRecommendation: strategy.toneRecommendation || '',
        platformStrategy,
        keyMessages: strategy.keyMessages || [],
      });

      // Bulk insert skeleton posts — captions generated on-demand per post
      await this.prisma.post.createMany({
        data: posts.map((p) => ({
          projectId,
          scheduledDate: new Date(p.date),
          platform: p.platform,
          format: p.format ?? 'post',
          topic: p.topic,
          hook: p.hook,
          caption: '',
          hashtags: p.hashtags || [],
          cta: '',
          creativeNote: p.creativeNote ?? '',
          status: 'DRAFT',
        })),
      });

      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'CALENDAR_READY' },
      });

      await this.prisma.client.update({
        where: { id: project.clientId },
        data: { status: 'CALENDAR_PENDING' },
      });

      return this.findOne(projectId);
    } catch (err) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'PLANNING' },
      });
      throw err;
    }
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.project.update({ where: { id }, data: { status: status as any } });
  }
}
