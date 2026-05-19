import { PostPayload, PublishResult, PlatformCredentials } from './publisher.types';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export class TikTokPublisher {
  async publish(payload: PostPayload, creds: PlatformCredentials): Promise<PublishResult> {
    const token = creds.accessToken;

    if (!payload.assetUrl) {
      throw new Error('TikTok requires a video or image asset to publish');
    }

    if (payload.assetType === 'video') {
      return this.publishVideo(payload, token, creds.accountId);
    }
    return this.publishPhoto(payload, token, creds.accountId);
  }

  private async publishVideo(
    payload: PostPayload,
    token: string,
    openId?: string,
  ): Promise<PublishResult> {
    const text = this.buildText(payload);

    // Step 1: Init upload
    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: text.slice(0, 150),
          privacy_level: 'SELF_ONLY', // Use PUBLIC_TO_EVERYONE once credentials are real
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: payload.assetUrl,
        },
      }),
    });

    const initData = await initRes.json() as any;
    if (!initRes.ok || initData.error?.code !== 'ok') {
      throw new Error(`TikTok video init failed: ${initData.error?.message || JSON.stringify(initData)}`);
    }

    const publishId = initData.data?.publish_id;
    const liveUrl = openId
      ? `https://www.tiktok.com/@${openId}/video/${publishId}`
      : 'https://www.tiktok.com';

    return { platformPostId: publishId, liveUrl };
  }

  private async publishPhoto(
    payload: PostPayload,
    token: string,
    openId?: string,
  ): Promise<PublishResult> {
    const text = this.buildText(payload);

    const res = await fetch(`${TIKTOK_API}/post/publish/content/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: text.slice(0, 150),
          privacy_level: 'SELF_ONLY',
          disable_comment: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: [payload.assetUrl],
        },
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || data.error?.code !== 'ok') {
      throw new Error(`TikTok photo post failed: ${data.error?.message || JSON.stringify(data)}`);
    }

    const publishId = data.data?.publish_id;
    return {
      platformPostId: publishId,
      liveUrl: `https://www.tiktok.com`,
    };
  }

  private buildText(payload: PostPayload): string {
    const tags = payload.hashtags?.map((h) => `#${h}`).join(' ') ?? '';
    return [payload.caption, tags].filter(Boolean).join(' ');
  }
}
