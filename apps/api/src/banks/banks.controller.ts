import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Bank, StageInfo } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { BanksService } from './banks.service';

@ApiTags('banks')
@Controller('banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class BanksController {
  constructor(private readonly banks: BanksService) {}

  @Get()
  @ApiOperation({ summary: '词书列表（含进度汇总）' })
  list(@Req() req: Request & { user: JwtUser }): Promise<Bank[]> {
    return this.banks.list(req.user.sub);
  }

  @Get(':code/stages')
  @ApiOperation({ summary: '词书阶段地图' })
  stages(
    @Req() req: Request & { user: JwtUser },
    @Param('code') code: string,
  ): Promise<StageInfo[]> {
    return this.banks.stages(req.user.sub, code);
  }
}