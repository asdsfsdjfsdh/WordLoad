import { BadRequestException, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { GameMode, LevelWord, Session } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get(':bankCode/:stageId/words')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '阶段词池单词预览（战斗前学习页，含学习状态）' })
  @ApiOkResponse({ description: '单词列表' })
  async stageWords(
    @Req() req: Request & { user: JwtUser },
    @Param('bankCode') bankCode: string,
    @Param('stageId') stageId: string,
    @Query('size') size?: string,
  ): Promise<LevelWord[]> {
    const id = this.parsePositiveInt(stageId, 'stageId');
    const sz = size ? Number.parseInt(size, 10) : undefined;
    return this.questions.listStageWords({ bankCode, stageId: id, size: sz, userId: req.user.sub });
  }

  @Get(':bankCode/:stageId/words/next')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取一个替换词（斩后补词），排除已显示单词' })
  async replacementWord(
    @Req() req: Request & { user: JwtUser },
    @Param('bankCode') bankCode: string,
    @Param('stageId') stageId: string,
    @Query('exclude') exclude?: string,
  ): Promise<LevelWord | null> {
    const id = this.parsePositiveInt(stageId, 'stageId');
    const excludeIds = exclude ? exclude.split(',').filter(Boolean) : [];
    return this.questions.getReplacementWord(bankCode, id, excludeIds, req.user.sub);
  }

  @Get(':bankCode/:stageId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '生成阶段战斗会话的题目' })
  @ApiOkResponse({ description: 'Session（题目列表）' })
  async buildSession(
    @Req() req: Request & { user: JwtUser },
    @Param('bankCode') bankCode: string,
    @Param('stageId') stageId: string,
    @Query('mode') mode: GameMode = 'zh2en',
  ): Promise<Session> {
    const id = this.parsePositiveInt(stageId, 'stageId');
    const plan = await this.questions.buildSession({
      userId: req.user.sub,
      bankCode,
      stageId: id,
      mode,
    });
    return plan.session;
  }

  @Post('words/:wordId/skip')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '标记单词为已掌握（一键斩），不再出题' })
  async skipWord(
    @Req() req: Request & { user: JwtUser },
    @Param('wordId') wordId: string,
  ): Promise<{ ok: boolean }> {
    await this.questions.skipWord(req.user.sub, wordId);
    return { ok: true };
  }

  @Post('words/:wordId/unskip')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '反斩：重置为未学状态，重新纳入出题' })
  async unskipWord(
    @Req() req: Request & { user: JwtUser },
    @Param('wordId') wordId: string,
  ): Promise<{ ok: boolean }> {
    await this.questions.unskipWord(req.user.sub, wordId);
    return { ok: true };
  }

  private parsePositiveInt(value: string, name: string): number {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${name} 非法`);
    return n;
  }
}
