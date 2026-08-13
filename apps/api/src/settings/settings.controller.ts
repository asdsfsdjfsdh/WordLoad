import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Post('reset-progress')
  @ApiOperation({ summary: '重置全部学习进度（词级/义项级/会话记录）' })
  resetProgress(@Req() req: Request & { user: JwtUser }): Promise<{ ok: boolean }> {
    return this.settings.resetProgress(req.user.sub);
  }
}