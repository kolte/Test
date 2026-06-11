import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AuthUserDto, LoginResponseDto, RefreshResponseDto } from './dto/auth.dto';
import { verifyPassword } from './password.util';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  // Random per-issuance ID. Without it, two tokens signed for the same user
  // within the same second would be byte-identical (JWTs are deterministic
  // given the same payload + iat/exp), which would silently defeat refresh
  // rotation - see `signRefreshToken` and the `jti` note there.
  jti: string;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private accessSecret(): string {
    return process.env.JWT_ACCESS_SECRET ?? 'change-me-access-secret';
  }

  private refreshSecret(): string {
    return process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh-secret';
  }

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, type: 'access', jti: randomUUID() };
    return this.jwt.sign(payload, { secret: this.accessSecret(), expiresIn: ACCESS_TOKEN_TTL });
  }

  /**
   * Signs a refresh token with a random `jti`. JWTs are a deterministic
   * function of header + payload + secret: two tokens for the same user
   * issued within the same second would otherwise have identical `iat`/`exp`
   * and therefore be byte-for-byte identical, which would make rotation in
   * `refresh()` a no-op from the client's perspective (and would make it
   * impossible to tell tokens apart if we ever add a revocation list). The
   * `jti` guarantees each issued token is unique regardless of timing.
   */
  private signRefreshToken(user: User): string {
    const payload: RefreshTokenPayload = { sub: user.id, type: 'refresh', jti: randomUUID() };
    return this.jwt.sign(payload, { secret: this.refreshSecret(), expiresIn: REFRESH_TOKEN_TTL });
  }

  toAuthUser(user: User): AuthUserDto {
    return {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name ?? user.email,
      roles: user.roles,
    };
  }

  /**
   * Validates credentials and issues a fresh access/refresh token pair.
   * Always reports the same generic "invalid credentials" error whether the
   * email is unknown or the password is wrong, so the endpoint can't be used
   * to enumerate registered accounts.
   */
  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Run a hash comparison anyway so the response time for "unknown email"
      // and "known email, wrong password" stays roughly the same.
      await verifyPassword(password, INVALID_CREDENTIALS_DUMMY_HASH);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    const passwordOk = await verifyPassword(password, user.password);
    if (!passwordOk) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user),
      user: this.toAuthUser(user),
    };
  }

  /**
   * Exchanges a valid, unexpired refresh token for a new access/refresh pair.
   * Refresh tokens are rotated on every use. The old token is not revoked
   * (stateless JWTs), but rotation limits how long a leaked token remains
   * useful to an attacker who isn't actively racing the legitimate client.
   */
  async refresh(refreshToken: string): Promise<RefreshResponseDto> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, { secret: this.refreshSecret() });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.' });
    }

    if (payload.type !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired.' });
    }

    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user),
    };
  }

  /** Verifies an access token and loads the user it belongs to. Used by JwtAuthGuard. */
  async verifyAccessToken(token: string): Promise<User> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.accessSecret() });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_ACCESS_TOKEN', message: 'Access token is invalid or expired.' });
    }

    if (payload.type !== 'access' || !payload.sub) {
      throw new UnauthorizedException({ code: 'INVALID_ACCESS_TOKEN', message: 'Access token is invalid or expired.' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_ACCESS_TOKEN', message: 'Access token is invalid or expired.' });
    }

    return user;
  }

  /** Returns the authenticated user's profile in the same shape as the login response. */
  async me(user: User): Promise<AuthUserDto> {
    return this.toAuthUser(user);
  }
}

// A syntactically-valid (but unusable) scrypt hash, compared against on an
// "unknown email" login attempt purely to keep the two failure paths'
// timing similar - see the comment in `login`.
const INVALID_CREDENTIALS_DUMMY_HASH =
  'scrypt:16384:8:1:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
