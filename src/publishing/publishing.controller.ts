import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PublishingService } from './publishing.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Publishing')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('publishing')
export class PublishingController {
  constructor(private service: PublishingService) {}

  @Get('queue')
  @Roles(Role.ADMIN)
  getQueue(@Query('clientId') clientId?: string) {
    return this.service.getQueue(clientId);
  }

  @Get('log')
  getLog(@Query('clientId') clientId?: string) {
    return this.service.getPublishedLog(clientId);
  }

  @Post('queue/:projectId')
  @Roles(Role.ADMIN)
  queueProject(@Param('projectId') projectId: string) {
    return this.service.queueProjectPosts(projectId);
  }

  @Post('publish/:postId')
  @Roles(Role.ADMIN)
  publishPost(@Param('postId') postId: string) {
    return this.service.publishPost(postId);
  }

  @Post('retry/:postId')
  @Roles(Role.ADMIN)
  retry(@Param('postId') postId: string) {
    return this.service.retryFailed(postId);
  }
}
