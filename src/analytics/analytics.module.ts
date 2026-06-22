import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsCron } from './analytics.cron';

// ScheduleModule.forRoot() is already imported in PublishingModule — NestJS's
// global scheduler discovers @Cron decorators across all modules automatically.
@Module({
  providers: [AnalyticsService, AnalyticsCron],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
