import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';
import { hashPassword } from './password.util';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient AuthService
 * touches (`prisma.user.findUnique` by id or by email) — same rationale as
 * `FakeTx` in sync.service.spec.ts: there's no live Postgres in this sandbox,
 * so the fake lets the *real* AuthService logic run against scripted data.
 */
class FakePrisma {
  users: User[] = [];

  user = {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id) return this.users.find((u) => u.id === where.id) ?? null;
      if (where.email) return this.users.find((u) => u.email === where.email) ?? null;
      return null;
    },
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'demo@example.com',
    password: 'will-be-overwritten',
    name: 'Demo User',
    organizationId: 'org-001',
    roles: ['employee'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as User;
}

const ENV_DEFAULTS = {
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
};

describe('AuthService', () => {
  let prisma: FakePrisma;
  let service: AuthService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    Object.assign(process.env, ENV_DEFAULTS);

    prisma = new FakePrisma();
    service = new AuthService(prisma as unknown as PrismaService, new JwtService({}));

    const password = await hashPassword('correct horse battery staple');
    prisma.users.push(makeUser({ password }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('login (#20 prerequisite)', () => {
    it('issues an access/refresh pair and the AuthUser shape the client expects on valid credentials', async () => {
      const result = await service.login('demo@example.com', 'correct horse battery staple');

      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
      expect(result.accessToken).not.toEqual(result.refreshToken);
      expect(result.user).toEqual({
        id: 'user-1',
        organizationId: 'org-001',
        email: 'demo@example.com',
        name: 'Demo User',
        roles: ['employee'],
      });
    });

    it('rejects an unknown email with the generic INVALID_CREDENTIALS error (no account enumeration)', async () => {
      await expect(service.login('nobody@example.com', 'whatever')).rejects.toMatchObject({
        response: { code: 'INVALID_CREDENTIALS' },
      });
    });

    it('rejects a known email with the wrong password using the same generic error', async () => {
      await expect(service.login('demo@example.com', 'wrong-password')).rejects.toMatchObject({
        response: { code: 'INVALID_CREDENTIALS' },
      });
    });

    it('falls back to the email when the user has no display name', async () => {
      const password = await hashPassword('pw');
      prisma.users.push(makeUser({ id: 'user-2', email: 'noname@example.com', name: null, password }));

      const result = await service.login('noname@example.com', 'pw');
      expect(result.user.name).toBe('noname@example.com');
    });
  });

  describe('refresh (#20)', () => {
    it('exchanges a valid refresh token for a new access/refresh pair', async () => {
      const { refreshToken: original } = await service.login('demo@example.com', 'correct horse battery staple');

      const rotated = await service.refresh(original);

      expect(typeof rotated.accessToken).toBe('string');
      expect(typeof rotated.refreshToken).toBe('string');
      // Rotation: the new refresh token differs from the one that was exchanged.
      expect(rotated.refreshToken).not.toEqual(original);
    });

    it('rejects a malformed/garbage token', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an access token presented as a refresh token (wrong secret AND wrong "type" claim)', async () => {
      const { accessToken } = await service.login('demo@example.com', 'correct horse battery staple');
      await expect(service.refresh(accessToken)).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
    });

    it('rejects a refresh token whose subject no longer exists', async () => {
      const ghost = makeUser({ id: 'ghost-user' });
      const refreshToken = new JwtService({}).sign(
        { sub: ghost.id, type: 'refresh' },
        { secret: ENV_DEFAULTS.JWT_REFRESH_SECRET, expiresIn: '30d' },
      );

      await expect(service.refresh(refreshToken)).rejects.toMatchObject({
        response: { code: 'INVALID_REFRESH_TOKEN' },
      });
    });
  });

  describe('verifyAccessToken / me (#21)', () => {
    it('resolves the user behind a valid access token and returns the AuthUser profile shape', async () => {
      const { accessToken } = await service.login('demo@example.com', 'correct horse battery staple');

      const user = await service.verifyAccessToken(accessToken);
      expect(user.id).toBe('user-1');

      const profile = await service.me(user);
      expect(profile).toEqual({
        id: 'user-1',
        organizationId: 'org-001',
        email: 'demo@example.com',
        name: 'Demo User',
        roles: ['employee'],
      });
    });

    it('rejects a refresh token presented as an access token', async () => {
      const { refreshToken } = await service.login('demo@example.com', 'correct horse battery staple');
      await expect(service.verifyAccessToken(refreshToken)).rejects.toMatchObject({
        response: { code: 'INVALID_ACCESS_TOKEN' },
      });
    });

    it('rejects an expired access token', async () => {
      const expired = new JwtService({}).sign(
        { sub: 'user-1', email: 'demo@example.com', type: 'access' },
        { secret: ENV_DEFAULTS.JWT_ACCESS_SECRET, expiresIn: -10 },
      );

      await expect(service.verifyAccessToken(expired)).rejects.toMatchObject({
        response: { code: 'INVALID_ACCESS_TOKEN' },
      });
    });
  });
});
