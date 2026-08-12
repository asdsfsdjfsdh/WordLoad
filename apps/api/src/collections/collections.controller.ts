import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CollectedWord, CollectionStats, ConfusablesResponse, EncounterRecord } from '@word-journey/shared';
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
  @ApiOkResponse({ description: '已遇/已掌握/按tier分布' })
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
      status: status as 'new' | 'learning' | 'mastered' | 'wrongbook' | undefined,
      sort,
      search,
      page: page ? Number.parseInt(page, 10) : undefined,
      pageSize: pageSize ? Number.parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('words/:wordId/timeline')
  @ApiOperation({ summary: '单词相遇时间线' })
  @ApiOkResponse({ description: '该词每次相遇记录' })
  async timeline(
    @Req() req: Request & { user: JwtUser },
    @Param('wordId') wordId: string,
  ): Promise<EncounterRecord[]> {
    return this.collections.timeline(req.user.sub, wordId);
  }

  @Get('words/:wordId/confusables')
  @ApiOperation({ summary: '单词易混词' })
  @ApiOkResponse({ description: '该词全部形近/音近/义近词对' })
  async confusables(
    @Req() req: Request & { user: JwtUser },
    @Param('wordId') wordId: string,
  ): Promise<ConfusablesResponse> {
    return this.collections.confusables(req.user.sub, wordId);
  }
}
