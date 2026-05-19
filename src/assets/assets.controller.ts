import {
  Controller, Post, Get, Delete, Param, Query, Body,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Assets')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(private service: AssetsService) {}

  @Post('upload')
  @Roles(Role.DESIGNER, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('postId') postId: string,
    @Body('notes') notes: string,
    @CurrentUser() user: any,
  ) {
    return this.service.uploadCreative(postId, file, user.id, notes);
  }

  @Get()
  findByPost(@Query('postId') postId: string) {
    return this.service.findByPost(postId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.DESIGNER)
  remove(@Param('id') id: string) {
    return this.service.deleteAsset(id);
  }
}
