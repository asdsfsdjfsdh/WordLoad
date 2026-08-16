import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { ReadingMarkWordResponse, ReadingPaperSummary, ReadingPassageDetail, ReadingPassageSummary, ReadingSubmitResponse } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { ReadingService } from './reading.service';

class SubmitAnswerDto {
  @IsInt()
  @Min(1)
  seq!: number;

  @IsString()
  @IsIn(['A', 'B', 'C', 'D'])
  choice!: string;
}

class SubmitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers!: SubmitAnswerDto[];
}

class ProgressDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  currentSentence?: number;

  @IsOptional()
  @IsIn(['not-started', 'reading', 'done'])
  status?: 'not-started' | 'reading' | 'done';
}

class MarkWordDto {
  @IsString()
  word!: string;

  @IsIn(['save', 'remove'])
  action!: 'save' | 'remove';
}

@ApiTags('reading')
@Controller('reading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ReadingController {
  constructor(private readonly reading: ReadingService) {}

  @Get('papers')
  @ApiOperation({ summary: '真题卷列表（含各篇进度汇总）' })
  papers(@Req() req: Request & { user: JwtUser }): Promise<ReadingPaperSummary[]> {
    return this.reading.papers(req.user.sub);
  }

  @Get('papers/:paperId/passages')
  @ApiOperation({ summary: '某卷的篇章列表（A/B/C/D）' })
  passages(
    @Req() req: Request & { user: JwtUser },
    @Param('paperId', ParseIntPipe) paperId: number,
  ): Promise<ReadingPassageSummary[]> {
    return this.reading.passages(req.user.sub, paperId);
  }

  @Get('passages/:passageId')
  @ApiOperation({ summary: '篇章全文详情（句子/题目/词表/进度）' })
  detail(
    @Req() req: Request & { user: JwtUser },
    @Param('passageId', ParseIntPipe) passageId: number,
  ): Promise<ReadingPassageDetail> {
    return this.reading.detail(req.user.sub, passageId);
  }

  @Get('passages/:passageId/words/lookup')
  @ApiOperation({ summary: '点词查义：篇内词表 → 单词库回退' })
  lookupWord(
    @Req() req: Request & { user: JwtUser },
    @Param('passageId', ParseIntPipe) passageId: number,
    @Query('word') word: string,
  ): Promise<import('@word-journey/shared').ReadingWordLookupResult> {
    return this.reading.lookupWord(req.user.sub, passageId, word ?? '');
  }

  @Post('passages/:passageId/submit')
  @ApiOperation({ summary: '提交答案：判分 + 解析 + 更新进度' })
  submit(
    @Req() req: Request & { user: JwtUser },
    @Param('passageId', ParseIntPipe) passageId: number,
    @Body() body: SubmitDto,
  ): Promise<ReadingSubmitResponse> {
    return this.reading.submit(req.user.sub, passageId, body.answers);
  }

  @Post('passages/:passageId/progress')
  @ApiOperation({ summary: '保存阅读位置 / 标记状态' })
  updateProgress(
    @Req() req: Request & { user: JwtUser },
    @Param('passageId', ParseIntPipe) passageId: number,
    @Body() body: ProgressDto,
  ): Promise<{ ok: true }> {
    return this.reading.updateProgress(req.user.sub, passageId, body);
  }

  @Post('passages/:passageId/words/mark')
  @ApiOperation({ summary: '生词收集：收藏 / 取消收藏（词库联动图鉴）' })
  markWord(
    @Req() req: Request & { user: JwtUser },
    @Param('passageId', ParseIntPipe) passageId: number,
    @Body() body: MarkWordDto,
  ): Promise<ReadingMarkWordResponse> {
    return this.reading.markWord(req.user.sub, passageId, body);
  }
}
