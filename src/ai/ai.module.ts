import { Module } from '@nestjs/common';
import { StrategyAgentService } from './strategy-agent.service';
import { CalendarAgentService } from './calendar-agent.service';

@Module({
  providers: [StrategyAgentService, CalendarAgentService],
  exports: [StrategyAgentService, CalendarAgentService],
})
export class AiModule {}
