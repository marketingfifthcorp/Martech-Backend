import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { MailService } from '../mail/mail.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByClerkId(clerkId: string) {
    return this.prisma.user.findUnique({ where: { clerkId } });
  }

  async upsertFromClerk(data: {
    clerkId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  }) {
    return this.prisma.user.upsert({
      where: { clerkId: data.clerkId },
      update: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
      },
      create: {
        clerkId: data.clerkId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
        role: 'CLIENT',
      },
    });
  }

  async updateRole(id: string, role: Role) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  async inviteUser(email: string, role: Role) {
    const normalised = email.toLowerCase().trim();

    // Upsert the invitation so re-inviting the same email just updates the role
    await this.prisma.invitation.upsert({
      where:  { email: normalised },
      update: { role },
      create: { email: normalised, role },
    });

    await this.mail.sendInvite(normalised, role);

    this.logger.log(`Invited ${normalised} as ${role}`);
    return { success: true, email: normalised, role };
  }

  async deactivate(clerkId: string) {
    return this.prisma.user.update({
      where: { clerkId },
      data: { isActive: false },
    });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        adminClients: { select: { id: true, name: true, status: true } },
        clientOf: { select: { id: true, name: true, status: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
