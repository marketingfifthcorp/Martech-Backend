import {
  Controller, Get, Post, Put, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StrategyService } from './strategy.service';
import { GenerateStrategyDto, UpdateStrategyDto } from './dto/create-strategy.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Role } from '@prisma/client';
import { IsString, IsOptional } from 'class-validator';

class ApprovalDto {
  @IsString() action: 'APPROVED' | 'CHANGES_REQUESTED';
  @IsOptional() @IsString() comment?: string;
}

@ApiTags('Strategy')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('strategy')
export class StrategyController {
  constructor(private service: StrategyService) {}

  /** Admin: trigger AI generation */
  @Post('generate')
  @Roles(Role.ADMIN)
  generate(@Body() dto: GenerateStrategyDto) {
    return this.service.generate(dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.CLIENT)
  findAll(@Query('briefId') briefId: string, @Query('clientId') clientId: string) {
    if (briefId) return this.service.findByBrief(briefId);
    if (clientId) return this.service.findByClient(clientId);
    return [];
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /** Admin: edit strategy before sending */
  @Put(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateStrategyDto) {
    return this.service.update(id, dto);
  }

  /** Admin: send to client */
  @Post(':id/send')
  @Roles(Role.ADMIN)
  sendToClient(@Param('id') id: string) {
    return this.service.sendToClient(id);
  }

  /** Admin: resend after addressing client feedback */
  @Post(':id/resend')
  @Roles(Role.ADMIN)
  resend(@Param('id') id: string) {
    return this.service.resend(id);
  }

  /** Client: approve or request changes */
  @Post(':id/approve')
  @Roles(Role.CLIENT, Role.ADMIN)
  approve(
    @Param('id') id: string,
    @Body() dto: ApprovalDto,
    @CurrentUser() user: any,
  ) {
    return this.service.submitApproval(id, user.id, dto.action, dto.comment);
  }
}
