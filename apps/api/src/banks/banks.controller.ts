import { Controller, Get, Param, ParseIntPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Bank, LevelInfo, RegionInfo, StageInfo, StageLeaderboard } from '@word-journey/shared';
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
  @ApiOperation({ summary: '词书阶段地图（flat 单层 / hierarchical 外层阶段）' })
  stages(
    @Req() req: Request & { user: JwtUser },
    @Param('code') code: string,
  ): Promise<StageInfo[]> {
    return this.banks.stages(req.user.sub, code);
  }

  @Get(':code/regions')
  @ApiOperation({ summary: '外层阶段地图（hierarchical 词书：必考/基础/超纲）' })
  regions(
    @Req() req: Request & { user: JwtUser },
    @Param('code') code: string,
  ): Promise<RegionInfo[]> {
    return this.banks.regions(req.user.sub, code);
  }

  @Get(':code/regions/:regionId/levels')
  @ApiOperation({ summary: '内层关卡地图（hierarchical 词书：某外层阶段内的关卡链）' })
  levels(
    @Req() req: Request & { user: JwtUser },
    @Param('code') code: string,
    @Param('regionId', ParseIntPipe) regionId: number,
  ): Promise<LevelInfo[]> {
    return this.banks.levels(req.user.sub, code, regionId);
  }

  @Get(':code/stages/:stageId/leaderboard')
  @ApiOperation({ summary: '阶段排行榜（按每用户最高生存天数）' })
  leaderboard(
    @Req() req: Request & { user: JwtUser },
    @Param('code') code: string,
    @Param('stageId', ParseIntPipe) stageId: number,
  ): Promise<StageLeaderboard> {
    return this.banks.leaderboard(req.user.sub, code, stageId);
  }
}