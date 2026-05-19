import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${config.get('CLERK_JWT_ISSUER')}/.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: null,
      issuer: config.get('CLERK_JWT_ISSUER'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: any) {
    const clerkId = payload.sub;
    if (!clerkId) throw new UnauthorizedException('Invalid token');

    let user = await this.prisma.user.findUnique({ where: { clerkId } });

    // Resolve real email: JWT claim first, then Clerk API fallback
    const realEmail = await this.resolveEmail(clerkId, payload);

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          clerkId,
          email: realEmail,
          firstName: payload.first_name ?? null,
          lastName: payload.last_name ?? null,
          role: 'CLIENT',
        },
      });
    } else if (realEmail && user.email.endsWith('@unknown.local')) {
      // Heal users provisioned before Clerk email resolution was in place
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { email: realEmail },
      });
    }

    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    return user;
  }

  /** Returns the best available email for this Clerk user. */
  private async resolveEmail(clerkId: string, payload: any): Promise<string> {
    // 1. JWT may already carry email if the template was customised
    if (payload.email && !payload.email.includes('@unknown.local')) {
      return payload.email as string;
    }

    // 2. Fetch from Clerk REST API using the secret key
    try {
      const secret = this.config.get<string>('CLERK_SECRET_KEY');
      const res = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (res.ok) {
        const data: any = await res.json();
        const primary = data.email_addresses?.find(
          (e: any) => e.id === data.primary_email_address_id,
        );
        const email = primary?.email_address ?? data.email_addresses?.[0]?.email_address;
        if (email) return email;
      }
    } catch (err: any) {
      this.logger.warn(`Could not resolve Clerk email for ${clerkId}: ${err.message}`);
    }

    return `${clerkId}@unknown.local`;
  }
}
