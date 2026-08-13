import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { StatsHeatmapResult, StatsOverview, StatsTrendPoint } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  @ApiOperation({ summary: '学习统计总览' })
  @ApiOkResponse({ description: '累计战斗/时长/掌握/连击/连胜天数' })
  async overview(@Req() req: Request & { user: JwtUser }): Promise<StatsOverview> {
    return this.stats.overview(req.user.sub);
  }

  @Get('trend')
  @ApiOperation({ summary: '近 N 天学习趋势' })
  @ApiOkResponse({ description: '逐日答题/正确率/XP/学时' })
  async trend(
    @Req() req: Request & { user: JwtUser },
    @Query('range') range?: string,
  ): Promise<StatsTrendPoint[]> {
    const n = Number.parseInt(range ?? '7', 10);
    const days = n === 14 ? 14 : n === 30 ? 30 : 7;
    return this.stats.trend(req.user.sub, days);
  }

  @Get('heatmap')
  @ApiOperation({ summary: '近期活跃热力图' })
  @ApiOkResponse({ description: '逐日答题数（默认近26周）' })
  async heatmap(
    @Req() req: Request & { user: JwtUser },
    @Query('weeks') weeks?: string,
  ): Promise<StatsHeatmapResult> {
    const w = Math.min(26, Math.max(4, Number.parseInt(weeks ?? '26', 10)));
    return this.stats.heatmap(req.user.sub, w);
  }
}