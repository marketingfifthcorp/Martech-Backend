import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async getForUser(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async create(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    link?: string;
  }) {
    return this.prisma.notification.create({ data });
  }

  async deleteOne(id: string, userId: string) {
    return this.prisma.notification.deleteMany({ where: { id, userId } });
  }

  /** Fire a notification for every ADMIN user. Fire-and-forget safe (never throws). */
  async notifyAdmins(data: { type: string; title: string; message: string; link?: string }) {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: Role.ADMIN, isActive: true },
        select: { id: true },
      });
      if (!admins.length) return;
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({ userId: a.id, ...data })),
      });
    } catch {}
  }

  /** Fire a notification for a specific user. Fire-and-forget safe. */
  async notifyUser(userId: string | null | undefined, data: { type: string; title: string; message: string; link?: string }) {
    if (!userId) return;
    try {
      await this.prisma.notification.create({ data: { userId, ...data } });
    } catch {}
  }
}
