import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { Role } from '@prisma/client';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateClientDto, adminId: string) {
    return this.prisma.client.create({
      data: {
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        adminId,
      },
    });
  }

  async findAll(user: { id: string; role: string; email: string }) {
    if (user.role === 'ADMIN') {
      return this.prisma.client.findMany({
        where: { adminId: user.id },
        include: { projects: { select: { id: true, month: true, year: true, status: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (user.role === 'DESIGNER') {
      return this.prisma.client.findMany({
        where: { status: { in: ['ACTIVE', 'CALENDAR_PENDING'] } },
        include: { projects: true },
        orderBy: { name: 'asc' },
      });
    }

    if (user.role === 'CLIENT') {
      // Try linked first
      let client = await this.prisma.client.findFirst({
        where: { clientUserId: user.id },
        include: { projects: { select: { id: true, month: true, year: true, status: true } } },
      });

      // Auto-link on first login: match by contactEmail
      if (!client && user.email) {
        client = await this.prisma.client.findFirst({
          where: { contactEmail: user.email },
          include: { projects: { select: { id: true, month: true, year: true, status: true } } },
        });
        if (client) {
          await this.prisma.client.update({
            where: { id: client.id },
            data: { clientUserId: user.id },
          });
        }
      }

      return client ? [client] : [];
    }

    return [];
  }

  async findOne(id: string, userId: string, role: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        briefs: {
          include: { strategies: { orderBy: { createdAt: 'desc' } } },
          orderBy: { createdAt: 'desc' },
        },
        projects: {
          include: { posts: { include: { assets: true, approvals: true } } },
          orderBy: { createdAt: 'desc' },
        },
        platformConnections: true,
        admin: { select: { id: true, firstName: true, lastName: true, email: true } },
        clientUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Access control
    if (role === 'CLIENT' && client.clientUserId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return client;
  }

  async update(id: string, dto: Partial<CreateClientDto>, adminId: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.adminId !== adminId) throw new ForbiddenException('Access denied');

    return this.prisma.client.update({
      where: { id },
      data: {
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
    });
  }

  async updateStatus(id: string, status: string, adminId: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.adminId !== adminId) throw new ForbiddenException('Access denied');

    return this.prisma.client.update({ where: { id }, data: { status: status as any } });
  }

  async remove(id: string, adminId: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.adminId !== adminId) throw new ForbiddenException('Access denied');

    return this.prisma.client.delete({ where: { id } });
  }

  async getOverview(clientId: string, userId: string, role: string) {
    // Run all 4 queries in parallel — auth is verified from the client result
    const [client, strategies, posts, projects] = await Promise.all([
      this.prisma.client.findUnique({
        where: { id: clientId },
        include: {
          briefs: { orderBy: { createdAt: 'desc' } },
          platformConnections: true,
          admin: { select: { id: true, firstName: true, lastName: true, email: true } },
          clientUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.strategy.findMany({
        where: { brief: { clientId } },
        include: {
          brief: { select: { clientId: true } },
          approvals: {
            include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.post.findMany({
        where: { project: { clientId } },
        include: {
          assets: { where: { isCurrent: true } },
          approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
          project: { select: { id: true, month: true, year: true, title: true } },
        },
        orderBy: { scheduledDate: 'asc' },
      }),
      this.prisma.project.findMany({
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
      }),
    ]);

    if (!client) throw new NotFoundException('Client not found');
    if (role === Role.ADMIN && client.adminId !== userId) throw new ForbiddenException('Access denied');
    if (role === Role.CLIENT && client.clientUserId !== userId) throw new ForbiddenException('Access denied');

    return { client, strategies, posts, projects };
  }

  async getStats(adminId: string) {
    const [total, active, onboarding, pendingApproval] = await Promise.all([
      this.prisma.client.count({ where: { adminId } }),
      this.prisma.client.count({ where: { adminId, status: 'ACTIVE' } }),
      this.prisma.client.count({ where: { adminId, status: 'ONBOARDING' } }),
      this.prisma.client.count({
        where: {
          adminId,
          status: { in: ['STRATEGY_SENT', 'CALENDAR_PENDING'] },
        },
      }),
    ]);
    return { total, active, onboarding, pendingApproval };
  }
}
