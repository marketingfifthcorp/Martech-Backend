import {
  Controller, Get, Post, Param, Query,
  UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

type Period = '15d' | '30d' | '60d' | '90d';
const VALID_PERIODS: Period[] = ['15d', '30d', '60d', '90d'];

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private analytics: AnalyticsService,
    private prisma: PrismaService,
  ) {}

  @Get(':clientId')
  async getAnalytics(
    @Param('clientId') clientId: string,
    @Query('period') period: string,
    @CurrentUser() user: any,
  ) {
    // Ownership check — mirrors the pattern in ClientsService.findOne
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (user.role === 'ADMIN' && client.adminId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    if (user.role === 'CLIENT' && client.clientUserId !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    const safePeriod: Period = VALID_PERIODS.includes(period as Period)
      ? (period as Period)
      : '30d';

    return this.analytics.getAnalytics(clientId, safePeriod);
  }

  /** Local-testing helper: manually seed today's follower snapshot without waiting for midnight cron */
  @Post('seed-follower-snapshot')
  async seedFollowerSnapshot(@CurrentUser() user: any) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('ADMIN only');
    return this.analytics.seedFollowerSnapshot();
  }
}
