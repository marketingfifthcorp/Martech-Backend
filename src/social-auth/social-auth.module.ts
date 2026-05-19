import { Module } from '@nestjs/common';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';

@Module({
  providers: [SocialAuthService],
  controllers: [SocialAuthController],
  exports: [SocialAuthService],
})
export class SocialAuthModule {}
