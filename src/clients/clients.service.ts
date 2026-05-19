import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';

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
