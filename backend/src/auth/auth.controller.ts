import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUserDto, LoginDto, LoginResponseDto, RefreshDto, RefreshResponseDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  /** Exchanges a refresh token for a new access/refresh pair. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto): Promise<RefreshResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  /** Returns the signed-in user's profile. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: User): Promise<AuthUserDto> {
    return this.authService.me(user);
  }
}
