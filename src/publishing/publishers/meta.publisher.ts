import { Logger } from '@nestjs/common';
import { PostPayload, PublishResult, PlatformCredentials } from './publisher.types';

const GRAPH = 'https://graph.facebook.com/v19.0';

export class MetaPublisher {
  private readonly logger = new Logger(MetaPublisher.name);

  async publish(payload: PostPayload, creds: PlatformCredentials): Promise<PublishResult> {
    const token = creds.accessToken;

    // Resolve the Instagram Business Account ID
    // accountId stored during OAuth is the IG user ID; fall back to page lookup
    let igUserId = creds.accountId;
    if (!igUserId) {
      igUserId = await this.resolveIgUserId(token);
    }

    const caption = this.buildCaption(payload);

    // Step 1: Create media container
    const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: payload.assetUrl,
        caption,
        access_token: token,
      }),
    });
    const container = await containerRes.json() as any;
    if (!containerRes.ok) {
      throw new Error(`Meta create container failed: ${container.error?.message || JSON.stringify(container)}`);
    }

    // Step 2: Publish container
    const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: container.id,
        access_token: token,
      }),
    });
    const published = await publishRes.json() as any;
    if (!publishRes.ok) {
      throw new Error(`Meta publish failed: ${published.error?.message || JSON.stringify(published)}`);
    }

    // Step 3: Get permalink
    const mediaRes = await fetch(
      `${GRAPH}/${published.id}?fields=permalink&access_token=${token}`,
    );
    const mediaData = await mediaRes.json() as any;
    const liveUrl = mediaData.permalink || `https://www.instagram.com/p/${published.id}`;

    return { platformPostId: published.id, liveUrl };
  }

  // Resolves IG business account ID from user access token via Facebook Pages
  private async resolveIgUserId(token: string): Promise<string> {
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${token}`);
    const pages = await pagesRes.json() as any;
    if (!pages.data?.length) throw new Error('No Facebook Pages found for this account');

    for (const page of pages.data) {
      const igRes = await fetch(
        `${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`,
      );
      const igData = await igRes.json() as any;
      if (igData.instagram_business_account?.id) {
        return igData.instagram_business_account.id;
      }
    }
    throw new Error(
      'No Instagram Business Account linked to any Facebook Page. Connect an IG Business/Creator account to a Facebook Page first.',
    );
  }

  private buildCaption(payload: PostPayload): string {
    const tags = payload.hashtags?.map((h) => `#${h}`).join(' ') ?? '';
    return [payload.caption, tags].filter(Boolean).join('\n\n');
  }
}
