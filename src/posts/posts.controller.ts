import {
  Controller, Get, Put, Post, Patch, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { UpdatePostDto } from './dto/update-post.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Role } from '@prisma/client';
import { IsString, IsOptional } from 'class-validator';

class PostApprovalDto {
  @IsString() action: 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
  @IsOptional() @IsString() comment?: string;
}

@ApiTags('Posts')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('posts')
export class PostsController {
  constructor(private service: PostsService) {}

  @Get()
  findAll(
    @Query('projectId') projectId: string,
    @Query('clientId') clientId: string,
  ) {
    if (projectId) return this.service.findByProject(projectId);
    if (clientId) return this.service.findByClient(clientId);
    return [];
  }

  @Get('approval-queue')
  getApprovalQueue(@Query('clientId') clientId: string) {
    return this.service.getApprovalQueue(clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdatePostDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.DESIGNER)
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.service.updateStatus(id, status);
  }

  @Post(':id/expand-caption')
  @Roles(Role.ADMIN)
  expandCaption(@Param('id') id: string) {
    return this.service.expandCaption(id);
  }

  @Post(':id/improve-field')
  @Roles(Role.ADMIN)
  improveField(
    @Param('id') id: string,
    @Body('field') field: string,
    @Body('instruction') instruction: string,
  ) {
    return this.service.improveField(id, field, instruction || '');
  }

  @Post(':id/creative-uploaded')
  @Roles(Role.DESIGNER, Role.ADMIN)
  markCreativeUploaded(@Param('id') id: string) {
    return this.service.markCreativeUploaded(id);
  }

  @Post(':id/approve')
  @Roles(Role.CLIENT, Role.ADMIN)
  approve(
    @Param('id') id: string,
    @Body() dto: PostApprovalDto,
    @CurrentUser() user: any,
  ) {
    return this.service.submitApproval(id, user.id, dto.action, dto.comment);
  }
}
