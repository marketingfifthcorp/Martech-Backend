import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private service: ProjectsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: { clientId: string; strategyId?: string; title: string; month: number; year: number }) {
    return this.service.create(dto);
  }

  @Get()
  findByClient(@Query('clientId') clientId: string) {
    return this.service.findByClient(clientId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/generate-calendar')
  @Roles(Role.ADMIN)
  generateCalendar(@Param('id') id: string) {
    return this.service.generateCalendar(id);
  }
}
