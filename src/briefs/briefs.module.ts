import { Module } from '@nestjs/common';
import { BriefsService } from './briefs.service';
import { BriefsController } from './briefs.controller';

@Module({
  providers: [BriefsService],
  controllers: [BriefsController],
  exports: [BriefsService],
})
export class BriefsModule {}
