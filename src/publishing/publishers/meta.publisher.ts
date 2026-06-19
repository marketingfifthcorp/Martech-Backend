import { Logger } from '@nestjs/common';
import { PostPayload, PublishResult, PlatformCredentials } from './publisher.types';

const GRAPH = 'https://graph.facebook.com/v23.0';

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

    if (!payload.assetUrl) {
      throw new Error(
        'No creative uploaded for this post. Upload an image or video in the Design Queue before publishing.',
      );
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

    // Step 4: Post the same content to the linked Facebook Page.
    // Non-blocking — Instagram already published; a Facebook failure should not
    // roll back or fail the overall job.
    try {
      await this.publishToFacebookPage(token, caption, payload.assetUrl);
    } catch (e: any) {
      this.logger.warn(`Facebook Page post failed (Instagram post succeeded): ${e.message}`);
    }

    return { platformPostId: published.id, liveUrl };
  }

  // Posts content to the Facebook Page whose access token we already hold.
  // A Page-scoped token's /me endpoint resolves to the Page itself, so we can
  // derive the Page ID without storing it separately during OAuth.
  private async publishToFacebookPage(
    pageToken: string,
    message: string,
    imageUrl?: string,
  ): Promise<void> {
    const pageRes = await fetch(`${GRAPH}/me?fields=id&access_token=${pageToken}`);
    const pageData = await pageRes.json() as any;
    if (!pageRes.ok || !pageData.id) {
      throw new Error(
        `Could not resolve Facebook Page ID: ${pageData.error?.message ?? JSON.stringify(pageData)}`,
      );
    }
    const pageId = pageData.id;

    // Use /photos for image posts (renders inline), /feed for text-only
    const endpoint = imageUrl
      ? `${GRAPH}/${pageId}/photos`
      : `${GRAPH}/${pageId}/feed`;

    const body: Record<string, string> = { message, access_token: pageToken };
    if (imageUrl) body.url = imageUrl;

    const feedRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const feedData = await feedRes.json() as any;
    if (!feedRes.ok) {
      throw new Error(
        `Facebook Page post failed: ${feedData.error?.message ?? JSON.stringify(feedData)}`,
      );
    }
    this.logger.log(`Facebook Page post created: ${feedData.post_id ?? feedData.id}`);
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
