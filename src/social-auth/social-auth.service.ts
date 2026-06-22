import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

type Platform = 'meta' | 'linkedin' | 'tiktok' | 'x';

// Temporary server-side store for PKCE code verifiers (X/Twitter)
const pkceStore = new Map<string, string>();

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private get backendUrl() {
    return this.config.get<string>('BACKEND_URL') || 'http://localhost:3001';
  }
  private get frontendUrl() {
    return this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }
  private get metaGraph() { return 'https://graph.facebook.com/v23.0'; }
  private get metaDialog() { return 'https://www.facebook.com/v23.0'; }
  private callbackUrl(platform: string) {
    return `${this.backendUrl}/api/v1/social-auth/${platform}/callback`;
  }

  /** Returns the OAuth authorization URL for the given platform */
  getConnectUrl(platform: Platform, clientId: string): string {
    const stateData = JSON.stringify({ clientId, platform });
    const state = Buffer.from(stateData).toString('base64url');

    switch (platform) {
      case 'meta':      return this.buildMetaUrl(state);
      case 'linkedin':  return this.buildLinkedInUrl(state);
      case 'tiktok':    return this.buildTikTokUrl(state);
      case 'x':         return this.buildXUrl(state);
      default: throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
  }

  // ─── OAuth URL builders ──────────────────────────────────────

  private buildMetaUrl(state: string): string {
    const appId = this.config.get('META_APP_ID');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: this.callbackUrl('meta'),
      state,
      scope: 'instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,instagram_manage_insights',
      response_type: 'code',
      auth_type: 'rerequest',
    });
    return `${this.metaDialog}/dialog/oauth?${params}`;
  }

  private buildLinkedInUrl(state: string): string {
    const clientId = this.config.get('LINKEDIN_CLIENT_ID');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.callbackUrl('linkedin'),
      state,
      scope: 'openid profile w_member_social',
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  }

  private buildTikTokUrl(state: string): string {
    const clientKey = this.config.get('TIKTOK_CLIENT_KEY');
    const params = new URLSearchParams({
      client_key: clientKey,
      scope: 'user.info.basic,video.publish,video.upload',
      response_type: 'code',
      redirect_uri: this.callbackUrl('tiktok'),
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize?${params}`;
  }

  private buildXUrl(state: string): string {
    const clientId = this.config.get('X_CLIENT_ID');
    // PKCE: generate code verifier + challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    pkceStore.set(state, codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: this.callbackUrl('x'),
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  // ─── OAuth Callbacks ─────────────────────────────────────────

  async handleCallback(platform: Platform, code: string, state: string): Promise<string> {
    let stateData: { clientId: string; platform: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      throw new BadRequestException('Invalid OAuth state');
    }
    const { clientId } = stateData;

    try {
      switch (platform) {
        case 'meta':     await this.handleMetaCallback(code, state, clientId); break;
        case 'linkedin': await this.handleLinkedInCallback(code, state, clientId); break;
        case 'tiktok':   await this.handleTikTokCallback(code, state, clientId); break;
        case 'x':        await this.handleXCallback(code, state, clientId); break;
      }
      return `${this.frontendUrl}/clients/${clientId}?tab=6&connected=${platform}`;
    } catch (e: any) {
      this.logger.error(`${platform} OAuth callback failed:`, e.message);
      const msg = encodeURIComponent(e.message || 'OAuth failed');
      return `${this.frontendUrl}/clients/${clientId}?tab=6&error=${platform}&msg=${msg}`;
    }
  }

  // ─── Meta ────────────────────────────────────────────────────

  private async handleMetaCallback(code: string, state: string, clientId: string) {
    const appId = this.config.get('META_APP_ID');
    const appSecret = this.config.get('META_APP_SECRET');

    // Exchange code for short-lived token
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: this.callbackUrl('meta'),
      code,
    });
    const tokenRes = await fetch(
      `${this.metaGraph}/oauth/access_token?${tokenParams}`,
    );
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.error?.message || 'Meta token exchange failed');

    // Exchange for long-lived token (60-day)
    const llParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenData.access_token,
    });
    const llRes = await fetch(`${this.metaGraph}/oauth/access_token?${llParams}`);
    const llData = await llRes.json() as any;
    const longLivedToken = llData.access_token || tokenData.access_token;
    const expiry = llData.expires_in
      ? new Date(Date.now() + llData.expires_in * 1000)
      : null;

    // Get Facebook Pages and linked Instagram Business Account
    let accountId: string | null = null;
    let accountName: string | null = null;
    let pageToken = longLivedToken;

    const pagesRes = await fetch(
      `${this.metaGraph}/me/accounts?access_token=${longLivedToken}`,
    );
    const pagesData = await pagesRes.json() as any;
    this.logger.log(`Meta pages lookup: found ${pagesData.data?.length ?? 0} page(s)`);

    if (!pagesData.data?.length) {
      throw new Error(
        'No Facebook Pages found on this account. ' +
        'You need a Facebook Page (not just a personal profile) to connect Instagram. ' +
        'Create a Facebook Page, then connect your Instagram Business/Creator account to it.',
      );
    }

    for (const page of pagesData.data) {
      this.logger.log(`Checking page "${page.name}" (${page.id}) for Instagram Business Account`);
      const igRes = await fetch(
        `${this.metaGraph}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`,
      );
      const igData = await igRes.json() as any;
      this.logger.log(`Page ${page.id} IG data: ${JSON.stringify(igData)}`);
      if (igData.instagram_business_account?.id) {
        accountId = igData.instagram_business_account.id;
        pageToken = page.access_token;

        // Get IG username
        const igInfoRes = await fetch(
          `${this.metaGraph}/${accountId}?fields=name,username&access_token=${pageToken}`,
        );
        const igInfo = await igInfoRes.json() as any;
        accountName = igInfo.username ? `@${igInfo.username}` : igInfo.name || 'Instagram Account';
        this.logger.log(`Found Instagram Business Account: ${accountName} (${accountId})`);
        break;
      }
    }

    if (!accountId) {
      const pageNames = pagesData.data.map((p: any) => `"${p.name}"`).join(', ');
      throw new Error(
        `Checked ${pagesData.data.length} Facebook Page(s) (${pageNames}) — none have an Instagram Business Account linked. ` +
        'Go to your Facebook Page → Settings → Instagram → Connect account. ' +
        'This is different from Account Center — you must link Instagram directly to the Page, not just your personal Facebook profile.',
      );
    }

    await this.upsertConnection({
      clientId, platform: 'instagram',
      accountId, accountName,
      accessToken: pageToken,
      tokenExpiry: expiry,
    });
  }

  // ─── LinkedIn ────────────────────────────────────────────────

  private async handleLinkedInCallback(code: string, _state: string, clientId: string) {
    const clientIdKey = this.config.get('LINKEDIN_CLIENT_ID');
    const clientSecret = this.config.get('LINKEDIN_CLIENT_SECRET');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl('linkedin'),
      client_id: clientIdKey,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'LinkedIn token exchange failed');

    const accessToken = tokenData.access_token;
    const expiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // Get person ID and name
    const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json() as any;
    const accountId = profile.sub;
    const accountName = profile.name || profile.email || 'LinkedIn User';

    await this.upsertConnection({
      clientId, platform: 'linkedin',
      accountId, accountName,
      accessToken,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: expiry,
    });
  }

  // ─── TikTok ──────────────────────────────────────────────────

  private async handleTikTokCallback(code: string, _state: string, clientId: string) {
    const clientKey = this.config.get('TIKTOK_CLIENT_KEY');
    const clientSecret = this.config.get('TIKTOK_CLIENT_SECRET');

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.callbackUrl('tiktok'),
      }).toString(),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error || 'TikTok token exchange failed');
    }

    const accessToken = tokenData.access_token;
    const openId = tokenData.open_id;
    const expiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // Get user info
    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const userData = await userRes.json() as any;
    const displayName = userData.data?.user?.display_name || `@${openId}`;

    await this.upsertConnection({
      clientId, platform: 'tiktok',
      accountId: openId,
      accountName: displayName,
      accessToken,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: expiry,
    });
  }

  // ─── X (Twitter) ─────────────────────────────────────────────

  private async handleXCallback(code: string, state: string, clientId: string) {
    const clientIdKey = this.config.get('X_CLIENT_ID');
    const clientSecret = this.config.get('X_CLIENT_SECRET');
    const codeVerifier = pkceStore.get(state);
    pkceStore.delete(state);

    if (!codeVerifier) throw new Error('X OAuth: PKCE code verifier not found. Try connecting again.');

    const credentials = Buffer.from(`${clientIdKey}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.callbackUrl('x'),
        code_verifier: codeVerifier,
      }).toString(),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) {
      throw new Error(tokenData.error_description || tokenData.error || 'X token exchange failed');
    }

    const accessToken = tokenData.access_token;
    const expiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // Get user info
    const userRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json() as any;
    const userId = userData.data?.id;
    const username = userData.data?.username || userId;

    await this.upsertConnection({
      clientId, platform: 'x',
      accountId: userId,
      accountName: `@${username}`,
      accessToken,
      refreshToken: tokenData.refresh_token,
      tokenExpiry: expiry,
    });
  }

  // ─── DB helpers ──────────────────────────────────────────────

  private async upsertConnection(data: {
    clientId: string;
    platform: string;
    accountId?: string | null;
    accountName?: string | null;
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiry?: Date | null;
  }) {
    return this.prisma.platformConnection.upsert({
      where: { clientId_platform: { clientId: data.clientId, platform: data.platform } },
      update: {
        accountId: data.accountId,
        accountName: data.accountName,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiry: data.tokenExpiry,
        isActive: true,
      },
      create: {
        clientId: data.clientId,
        platform: data.platform,
        accountId: data.accountId,
        accountName: data.accountName,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiry: data.tokenExpiry,
        isActive: true,
        scopes: [],
      },
    });
  }

  async listConnections(clientId: string) {
    const connections = await this.prisma.platformConnection.findMany({
      where: { clientId, isActive: true },
    });
    // Strip tokens before returning to client
    return connections.map(({ accessToken: _a, refreshToken: _r, ...safe }) => safe);
  }

  async disconnect(connectionId: string, clientId: string) {
    await this.prisma.platformConnection.deleteMany({
      where: { id: connectionId, clientId },
    });
    return { success: true };
  }
}
