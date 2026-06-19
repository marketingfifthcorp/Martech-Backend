import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected');
    } catch (err: any) {
      this.logger.error(`Database connection failed: ${err.message}`);
      this.logger.error('If using Supabase free tier, the project may be paused — resume it at supabase.com/dashboard');
      // Do not re-throw — let the app start so health-checks / logs are visible
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
