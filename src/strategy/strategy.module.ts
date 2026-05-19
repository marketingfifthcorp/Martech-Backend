import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AiModule, NotificationsModule],
  providers: [StrategyService],
  controllers: [StrategyController],
  exports: [StrategyService],
})
export class StrategyModule {}
