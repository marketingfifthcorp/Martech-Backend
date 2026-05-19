import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { BriefsModule } from './briefs/briefs.module';
import { StrategyModule } from './strategy/strategy.module';
import { ProjectsModule } from './projects/projects.module';
import { PostsModule } from './posts/posts.module';
import { AssetsModule } from './assets/assets.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { PublishingModule } from './publishing/publishing.module';
import { AiModule } from './ai/ai.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SocialAuthModule } from './social-auth/social-auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    BriefsModule,
    StrategyModule,
    ProjectsModule,
    PostsModule,
    AssetsModule,
    ApprovalsModule,
    PublishingModule,
    AiModule,
    WebhooksModule,
    NotificationsModule,
    SocialAuthModule,
  ],
})
export class AppModule {}
