import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  // No global secret/expiry here - AuthService signs and verifies access vs.
  // refresh tokens with their own secrets (JWT_ACCESS_SECRET /
  // JWT_REFRESH_SECRET, see .env.example) and TTLs, passed per-call.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PrismaService],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
