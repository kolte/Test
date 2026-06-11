import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { DesktopModule } from './desktop/desktop.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [AuthModule, DesktopModule, SyncModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
