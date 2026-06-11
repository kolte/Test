import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body of POST /desktop/devices/register: `{ deviceName, platform, appVersion }`.
 * The client currently always sends `platform: "windows"`; the @IsIn
 * constraint keeps the contract explicit without inventing support for
 * platforms that nothing emits yet.
 */
export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  deviceName!: string;

  @IsIn(['windows'])
  platform!: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}

/** Response shape for device registration, serialized as camelCase. */
export class DeviceRegistrationDto {
  id!: string;
  deviceName!: string;
  platform!: string;
  appVersion!: string;
}
