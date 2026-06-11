import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';

/** Augment Express's Request with the user the access token resolved to,
 * so `@CurrentUser()` (and controllers generally) can read `req.user`. */
export interface AuthenticatedRequest extends Request {
  user: User;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Validates the `Authorization: Bearer <accessToken>` header against
 * `AuthService.verifyAccessToken` and attaches the resolved user to the
 * request. Every `desktop/*` and `auth/me`-style endpoint that requires a
 * signed-in user should be guarded with this (matches `SendAsync`'s
 * `Authorization: Bearer {AccessToken}` header in Services/ApiClient.cs).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException({ code: 'MISSING_ACCESS_TOKEN', message: 'Authorization: Bearer <token> header is required.' });
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      throw new UnauthorizedException({ code: 'MISSING_ACCESS_TOKEN', message: 'Authorization: Bearer <token> header is required.' });
    }

    request.user = await this.authService.verifyAccessToken(token);
    return true;
  }
}
