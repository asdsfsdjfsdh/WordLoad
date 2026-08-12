import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { EnterBossResponse, BossExtendResponse, SessionFinish } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { SessionsService } from './sessions.service';

class AnswerDto {
  @IsInt()
  @Min(0)
  seq!: number;

  @IsBoolean()
  correct!: boolean;

  @IsNumber()
  @Min(0)
  elapsedMs!: number;

  @IsOptional()
  @IsString()
  typed?: string;
}

class CreateSessionDto {
  @IsString()
  bankCode!: string;

  @IsInt()
  @Min(1)
  stageId!: number;

  @IsString()
  @IsIn(['zh2en', 'dictation'])
  mode!: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(60)
  size?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  wordIds?: string[];
}

class SubmitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];

  @IsOptional()
  @IsBoolean()
  bossCleared?: boolean;
}

class EnterBossDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
}

class BossExtendDto {
  @IsArray()
  @IsString({ each: true })
  missedWordIds!: string[];
}

@ApiTags('sessions')
@Controller('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @ApiOperation({ summary: '创建会话并落库，返回 sessionId 与题目' })
  async create(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.createSession({
      userId: req.user.sub,
      bankCode: dto.bankCode,
      stageId: dto.stageId,
      mode: dto.mode,
      size: dto.size,
      wordIds: dto.wordIds,
    });
  }

  @Post(':id/submit')
  @ApiOperation({ summary: '提交全部答案并结算，返回评级/经验/金币/掉落' })
  async submit(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): Promise<SessionFinish> {
    return this.sessions.submit(req.user.sub, Number.parseInt(id, 10), dto.answers, dto.bossCleared ?? false);
  }

  @Post(':id/enter-boss')
  @ApiOperation({ summary: '学习段结束 → 生成 Boss 段题目' })
  async enterBoss(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: EnterBossDto,
  ): Promise<EnterBossResponse> {
    return this.sessions.enterBoss(req.user.sub, Number.parseInt(id, 10), dto.answers);
  }

  @Post(':id/boss-extend')
  @ApiOperation({ summary: 'Boss 段词尽 → 续词' })
  async bossExtend(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: BossExtendDto,
  ): Promise<BossExtendResponse> {
    return this.sessions.bossExtend(req.user.sub, Number.parseInt(id, 10), dto.missedWordIds);
  }
}