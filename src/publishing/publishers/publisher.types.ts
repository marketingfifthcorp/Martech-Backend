export interface PostPayload {
  caption: string;
  hashtags: string[];
  assetUrl?: string;
  assetType?: 'image' | 'video';
  topic?: string;
  cta?: string;
}

export interface PublishResult {
  platformPostId: string;
  liveUrl: string;
}

export interface PlatformPublisher {
  publish(payload: PostPayload, connection: PlatformCredentials): Promise<PublishResult>;
}

export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  accountName?: string;
}
