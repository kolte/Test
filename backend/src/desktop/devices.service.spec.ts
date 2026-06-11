import { Device, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/device.dto';

/**
 * Minimal in-memory stand-in for the slice of PrismaClient DevicesService
 * touches (`prisma.device.upsert` keyed on the `(userId, name)` composite
 * unique) - same rationale as `FakePrisma`/`FakeTx` elsewhere in this
 * scaffold (see auth.service.spec.ts, sync.service.spec.ts): there's no live
 * Postgres in this sandbox, so the fake lets the *real* DevicesService logic
 * run against scripted data, including the actual upsert-vs-create branch.
 */
class FakePrisma {
  devices: Device[] = [];
  private nextId = 1;

  device = {
    upsert: async ({
      where,
      update,
      create,
    }: {
      where: { userId_name: { userId: string; name: string } };
      update: Partial<Device>;
      create: Omit<Device, 'id' | 'lastSeenAt' | 'createdAt'>;
    }) => {
      const { userId, name } = where.userId_name;
      const existing = this.devices.find((d) => d.userId === userId && d.name === name);

      if (existing) {
        Object.assign(existing, update);
        return existing;
      }

      const created: Device = {
        id: `device-${this.nextId++}`,
        lastSeenAt: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T00:00:00.000Z'),
        ...create,
      } as Device;
      this.devices.push(created);
      return created;
    },
  };
}

function makeDto(overrides: Partial<RegisterDeviceDto> = {}): RegisterDeviceDto {
  return {
    deviceName: 'DEMO-PC',
    platform: 'windows',
    appVersion: '0.1.0',
    ...overrides,
  };
}

const USER: User = {
  id: 'user-1',
  email: 'demo@example.com',
  password: 'hashed',
  name: 'Demo User',
  organizationId: 'org-001',
  roles: ['employee'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('DevicesService', () => {
  let prisma: FakePrisma;
  let service: DevicesService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new DevicesService(prisma as unknown as PrismaService);
  });

  describe('register (#22)', () => {
    it('creates a new device on first registration and returns the DeviceRegistration shape', async () => {
      const result = await service.register(USER, makeDto());

      expect(result).toEqual({
        id: 'device-1',
        deviceName: 'DEMO-PC',
        platform: 'windows',
        appVersion: '0.1.0',
      });
      expect(prisma.devices).toHaveLength(1);
      expect(prisma.devices[0]).toMatchObject({ userId: 'user-1', name: 'DEMO-PC', platform: 'windows' });
    });

    it('upserts in place on re-registration of the same machine instead of creating a duplicate row', async () => {
      const first = await service.register(USER, makeDto({ appVersion: '0.1.0' }));
      const second = await service.register(USER, makeDto({ appVersion: '0.2.0' }));

      expect(second.id).toBe(first.id);
      expect(prisma.devices).toHaveLength(1);
      expect(prisma.devices[0].appVersion).toBe('0.2.0');
      expect(second.appVersion).toBe('0.2.0');
    });

    it('refreshes lastSeenAt and platform on re-registration', async () => {
      await service.register(USER, makeDto());
      const before = prisma.devices[0].lastSeenAt;

      // Force a different timestamp so we can tell the upsert touched it.
      prisma.devices[0].lastSeenAt = new Date('2020-01-01T00:00:00.000Z');
      await service.register(USER, makeDto());

      expect(prisma.devices[0].lastSeenAt).not.toEqual(before);
      expect(prisma.devices[0].lastSeenAt.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00.000Z').getTime());
    });

    it('keeps two different machines for the same user as separate device rows', async () => {
      await service.register(USER, makeDto({ deviceName: 'DEMO-PC' }));
      await service.register(USER, makeDto({ deviceName: 'LAPTOP-2' }));

      expect(prisma.devices).toHaveLength(2);
      expect(new Set(prisma.devices.map((d) => d.id)).size).toBe(2);
    });

    it('falls back to a placeholder appVersion when the request omits one', async () => {
      const result = await service.register(USER, makeDto({ appVersion: undefined }));

      expect(result.appVersion).toBe('unknown');
      expect(prisma.devices[0].appVersion).toBe('unknown');
    });
  });
});
