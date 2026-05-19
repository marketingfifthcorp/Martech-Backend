import {
  Controller, Get, Delete, Param, Query,
  UseGuards, Res, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { SocialAuthService } from './social-auth.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';

const SUPPORTED = ['meta', 'linkedin', 'tiktok', 'x'];

@ApiTags('Social Auth')
@Controller('social-auth')
export class SocialAuthController {
  constructor(private socialAuthService: SocialAuthService) {}

  /** Returns the OAuth authorization URL — frontend redirects the browser to it */
  @Get(':platform/connect-url')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  getConnectUrl(
    @Param('platform') platform: string,
    @Query('clientId') clientId: string,
  ) {
    if (!SUPPORTED.includes(platform)) throw new BadRequestException(`Unsupported platform: ${platform}`);
    if (!clientId) throw new BadRequestException('clientId is required');
    const url = this.socialAuthService.getConnectUrl(platform as any, clientId);
    return { url };
  }

  /** OAuth callback — platform redirects here after user grants access */
  @Get(':platform/callback')
  @Public()
  async handleCallback(
    @Param('platform') platform: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?tab=platforms&error=missing_params`);
    }
    const redirectUrl = await this.socialAuthService.handleCallback(platform as any, code, state);
    return res.redirect(redirectUrl);
  }

  /** List platform connections for a client (tokens stripped) */
  @Get('connections')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  listConnections(@Query('clientId') clientId: string) {
    if (!clientId) throw new BadRequestException('clientId is required');
    return this.socialAuthService.listConnections(clientId);
  }

  /** Disconnect a platform */
  @Delete('connections/:id')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  disconnect(@Param('id') id: string, @Query('clientId') clientId: string) {
    if (!clientId) throw new BadRequestException('clientId is required');
    return this.socialAuthService.disconnect(id, clientId);
  }
}
