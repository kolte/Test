import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Param decorator that pulls the user `JwtAuthGuard` attached to the request
 * (`req.user`). Use on any guarded route that needs to know who's calling -
 * `@CurrentUser() user: User`.
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});
