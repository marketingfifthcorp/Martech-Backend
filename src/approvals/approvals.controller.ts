import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@ApiTags('Approvals')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private service: ApprovalsService) {}

  @Get('pending')
  getPendingForClient(@Query('clientId') clientId: string) {
    return this.service.getPendingForClient(clientId);
  }

  @Get()
  findAll(
    @Query('strategyId') strategyId: string,
    @Query('postId') postId: string,
  ) {
    if (strategyId) return this.service.findByStrategy(strategyId);
    if (postId) return this.service.findByPost(postId);
    return [];
  }
}
