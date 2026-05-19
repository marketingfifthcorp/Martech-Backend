import {
  Controller, Post, Headers, Body, RawBodyRequest,
  Req, UnauthorizedException, Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Webhook } from 'svix';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private usersService: UsersService,
    private config: ConfigService,
  ) {}

  /**
   * Clerk user lifecycle webhook
   * Register this URL in Clerk dashboard → Webhooks
   */
  @Post('clerk')
  @Public()
  async clerkWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() body: any,
  ) {
    const secret = this.config.get('CLERK_WEBHOOK_SECRET');

    // Verify signature
    const wh = new Webhook(secret);
    let event: any;

    try {
      event = wh.verify(
        JSON.stringify(req.body),
        {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        },
      );
    } catch (err) {
      this.logger.warn('Clerk webhook verification failed', err.message);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const { type, data } = event;
    this.logger.log(`Clerk event: ${type}`);

    switch (type) {
      case 'user.created':
      case 'user.updated':
        await this.usersService.upsertFromClerk({
          clerkId: data.id,
          email: data.email_addresses?.[0]?.email_address,
          firstName: data.first_name,
          lastName: data.last_name,
          avatarUrl: data.image_url,
        });
        break;

      case 'user.deleted':
        if (data.id) await this.usersService.deactivate(data.id);
        break;

      default:
        this.logger.log(`Unhandled event type: ${type}`);
    }

    return { received: true };
  }
}
