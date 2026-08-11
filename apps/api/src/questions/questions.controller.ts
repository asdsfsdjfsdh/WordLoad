import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GameMode, Session } from '@word-journey/shared';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get(':bankCode/:stageId')
  @ApiOperation({ summary: '生成一次战斗会话的题目' })
  @ApiOkResponse({ description: 'Session（题目列表）' })
  async buildSession(
    @Param('bankCode') bankCode: string,
    @Param('stageId') stageId: string,
    @Query('mode') mode: GameMode = 'zh2en',
  ): Promise<Session> {
    const id = Number.parseInt(stageId, 10);
    if (!Number.isInteger(id) || id < 1) throw new Error('stageId 非法');
    return this.questions.buildSession({ bankCode, stageId: id, mode });
  }
}