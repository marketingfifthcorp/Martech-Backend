import { PostPayload, PublishResult, PlatformCredentials } from './publisher.types';

const LI_API = 'https://api.linkedin.com';

export class LinkedInPublisher {
  async publish(payload: PostPayload, creds: PlatformCredentials): Promise<PublishResult> {
    const token = creds.accessToken;

    // Resolve the person URN (stored as accountId during OAuth)
    let personId = creds.accountId;
    if (!personId) {
      personId = await this.resolvePersonId(token);
    }
    const author = `urn:li:person:${personId}`;
    const text = this.buildText(payload);

    const body: Record<string, any> = {
      author,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    // Attach image if available
    if (payload.assetUrl && payload.assetType === 'image') {
      const imageUrn = await this.uploadImage(token, author, payload.assetUrl);
      body.content = {
        media: {
          id: imageUrn,
        },
      };
    }

    const res = await fetch(`${LI_API}/rest/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`LinkedIn post failed: ${err}`);
    }

    // LinkedIn returns the post URN in the x-restli-id header
    const postUrn = res.headers.get('x-restli-id') || res.headers.get('X-RestLi-Id') || '';
    const postId = postUrn.split(':').pop() || postUrn;
    const liveUrl = personId
      ? `https://www.linkedin.com/feed/update/${postUrn}/`
      : `https://www.linkedin.com`;

    return { platformPostId: postId, liveUrl };
  }

  private async resolvePersonId(token: string): Promise<string> {
    const res = await fetch(`${LI_API}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as any;
    if (!data.sub) throw new Error('Could not resolve LinkedIn person ID');
    return data.sub;
  }

  // Upload image to LinkedIn and return the digitalmedia URN
  private async uploadImage(token: string, author: string, imageUrl: string): Promise<string> {
    // Step 1: Initialize upload
    const initRes = await fetch(`${LI_API}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202401',
      },
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
    });
    const initData = await initRes.json() as any;
    const { uploadUrl, image } = initData.value || {};
    if (!uploadUrl) throw new Error('LinkedIn image upload init failed');

    // Step 2: Fetch the image and upload
    const imgRes = await fetch(imageUrl);
    const imgBuffer = await imgRes.arrayBuffer();
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg' },
      body: imgBuffer,
    });

    return image;
  }

  private buildText(payload: PostPayload): string {
    const tags = payload.hashtags?.map((h) => `#${h}`).join(' ') ?? '';
    return [payload.caption, tags].filter(Boolean).join('\n\n');
  }
}
