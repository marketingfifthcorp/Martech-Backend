import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService) {}

  async findByStrategy(strategyId: string) {
    return this.prisma.approval.findMany({
      where: { strategyId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPost(postId: string) {
    return this.prisma.approval.findMany({
      where: { postId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingForClient(clientId: string) {
    const [pendingStrategies, pendingPosts] = await Promise.all([
      this.prisma.strategy.findMany({
        where: {
          status: 'SENT_TO_CLIENT',
          brief: { clientId },
        },
        include: { brief: { select: { clientId: true } } },
      }),
      this.prisma.post.findMany({
        where: {
          status: 'AWAITING_APPROVAL',
          project: { clientId },
        },
        include: {
          assets: { where: { isCurrent: true } },
          project: { select: { title: true, month: true, year: true } },
        },
        orderBy: { scheduledDate: 'asc' },
      }),
    ]);

    return { pendingStrategies, pendingPosts };
  }
}
