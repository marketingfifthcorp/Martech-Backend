import { PostPayload, PublishResult, PlatformCredentials } from './publisher.types';

const X_API = 'https://api.twitter.com/2';
const X_UPLOAD = 'https://upload.twitter.com/1.1';

export class XPublisher {
  async publish(payload: PostPayload, creds: PlatformCredentials): Promise<PublishResult> {
    const token = creds.accessToken;
    const text = this.buildText(payload);

    const body: Record<string, any> = { text };

    // Upload media if present
    if (payload.assetUrl && payload.assetType === 'image') {
      const mediaId = await this.uploadMedia(token, payload.assetUrl);
      if (mediaId) {
        body.media = { media_ids: [mediaId] };
      }
    }

    const res = await fetch(`${X_API}/tweets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      throw new Error(`X (Twitter) post failed: ${data.detail || data.title || JSON.stringify(data)}`);
    }

    const tweetId = data.data?.id;
    const username = creds.accountName || creds.accountId || 'user';
    const liveUrl = tweetId
      ? `https://twitter.com/${username}/status/${tweetId}`
      : 'https://twitter.com';

    return { platformPostId: tweetId, liveUrl };
  }

  // X media upload uses v1.1 API with OAuth 2.0 Bearer token (User Auth)
  private async uploadMedia(token: string, imageUrl: string): Promise<string | null> {
    try {
      const imgRes = await fetch(imageUrl);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const base64 = imgBuffer.toString('base64');
      const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';

      const params = new URLSearchParams({
        media_data: base64,
        media_type: mimeType,
      });

      const uploadRes = await fetch(`${X_UPLOAD}/media/upload.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      const uploadData = await uploadRes.json() as any;
      return uploadData.media_id_string ?? null;
    } catch {
      return null; // publish text-only if media upload fails
    }
  }

  private buildText(payload: PostPayload): string {
    const tags = payload.hashtags?.slice(0, 3).map((h) => `#${h}`).join(' ') ?? '';
    const full = [payload.caption, tags].filter(Boolean).join('\n\n');
    return full.slice(0, 280); // X character limit
  }
}
