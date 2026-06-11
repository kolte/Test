import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DeviceRegistrationDto, RegisterDeviceDto } from './dto/device.dto';
import { DevicesService } from './devices.service';

@Controller('desktop/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  /**
   * Registers or re-registers the calling device for the authenticated user.
   * Guarded: a Device always belongs to a User, and the owner is taken from
   * the access token rather than a client-supplied field.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@CurrentUser() user: User, @Body() dto: RegisterDeviceDto): Promise<DeviceRegistrationDto> {
    return this.devicesService.register(user, dto);
  }
}
