import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { PublishingCron } from './publishing.cron';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    NotificationsModule,
  ],
  providers: [PublishingService, PublishingCron],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
