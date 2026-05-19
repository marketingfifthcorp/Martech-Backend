import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Clients')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateClientDto, @CurrentUser() user: any) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.DESIGNER, Role.CLIENT)
  findAll(@CurrentUser() user: any) {
    return this.service.findAll({ id: user.id, role: user.role, email: user.email });
  }

  @Get('stats')
  @Roles(Role.ADMIN)
  getStats(@CurrentUser() user: any) {
    return this.service.getStats(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user.id, user.role);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateClientDto>,
    @CurrentUser() user: any,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @CurrentUser() user: any,
  ) {
    return this.service.updateStatus(id, status, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.remove(id, user.id);
  }
}
