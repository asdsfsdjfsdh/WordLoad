import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CollectedWord, CollectionStats, SrsTrajectory } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { CollectionsService } from './collections.service';

@ApiTags('collections')
@Controller('collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('stats')
  @ApiOperation({ summary: '图鉴总览统计' })
  @ApiOkResponse({ description: '已遇/已掌握/待复习/按tier分布' })
  async stats(@Req() req: Request & { user: JwtUser }): Promise<CollectionStats> {
    return this.collections.stats(req.user.sub);
  }

  @Get('words')
  @ApiOperation({ summary: '图鉴单词卡片列表' })
  @ApiOkResponse({ description: '分页单词卡片' })
  async words(
    @Req() req: Request & { user: JwtUser },
    @Query('tier') tier?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ words: CollectedWord[]; total: number; page: number; pageSize: number }> {
    return this.collections.listWords(req.user.sub, {
      tier,
      status: status as 'new' | 'learning' | 'mastered' | 'wrongbook' | 'skipped' | 'due' | undefined,
      sort,
      search,
      page: page ? Number.parseInt(page, 10) : undefined,
      pageSize: pageSize ? Number.parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('words/:wordId/srs')
  @ApiOperation({ summary: '单词 SRS 复习轨迹 + 词详情' })
  @ApiOkResponse({ description: '档位变更史与当前记忆状态' })
  async srsTrajectory(
    @Req() req: Request & { user: JwtUser },
    @Param('wordId') wordId: string,
  ): Promise<SrsTrajectory> {
    return this.collections.srsTrajectory(req.user.sub, wordId);
  }
}
