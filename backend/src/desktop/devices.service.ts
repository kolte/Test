import { Injectable } from '@nestjs/common';
import { Device, User } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DeviceRegistrationDto, RegisterDeviceDto } from './dto/device.dto';

// Fallback recorded when a registration omits `appVersion`. The wire DTO
// treats the field as optional for defensive compatibility, but
// DeviceRegistrationDto.appVersion is non-nullable — this default avoids
// inventing a fake version string.
const UNKNOWN_APP_VERSION = 'unknown';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers or re-registers a desktop device for the authenticated user.
   * Upserts on the (userId, name) unique constraint so repeated calls from
   * the same machine — app restarts, reinstalls, version bumps — refresh the
   * existing row rather than accumulating duplicate Device rows that would
   * fragment the machine's session and sync history.
   */
  async register(user: User, dto: RegisterDeviceDto): Promise<DeviceRegistrationDto> {
    const appVersion = dto.appVersion ?? UNKNOWN_APP_VERSION;

    const device = await this.prisma.device.upsert({
      where: { userId_name: { userId: user.id, name: dto.deviceName } },
      update: {
        platform: dto.platform,
        appVersion,
        lastSeenAt: new Date(),
      },
      create: {
        userId: user.id,
        name: dto.deviceName,
        platform: dto.platform,
        appVersion,
      },
    });

    return this.toDeviceRegistration(device);
  }

  toDeviceRegistration(device: Device): DeviceRegistrationDto {
    return {
      id: device.id,
      deviceName: device.name,
      platform: device.platform,
      appVersion: device.appVersion ?? UNKNOWN_APP_VERSION,
    };
  }
}
