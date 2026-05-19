import {
  Controller, Get, Post, Put, Param, Body,
  UseGuards, UseInterceptors, UploadedFile, Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { BriefsService } from './briefs.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Briefs')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('briefs')
export class BriefsController {
  constructor(private service: BriefsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateBriefDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  findByClient(@Query('clientId') clientId: string) {
    return this.service.findByClient(clientId);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: Partial<CreateBriefDto>) {
    return this.service.update(id, dto);
  }

  @Post(':id/upload-brief')
  @Roles(Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadBriefFile(
    @Param('id') briefId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadFile(briefId, file, 'briefs');
  }

  @Post(':id/upload-brand-asset')
  @Roles(Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadBrandAsset(
    @Param('id') briefId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadFile(briefId, file, 'brand-assets');
  }
}
