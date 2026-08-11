import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { SessionFinish } from '@word-journey/shared';
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
}

class CreateSessionDto {
  @IsString()
  bankCode!: string;

  @IsInt()
  @Min(1)
  stageId!: number;

  @IsString()
  mode!: string;
}

class SubmitDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];
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
    });
  }

  @Post(':id/submit')
  @ApiOperation({ summary: '提交全部答案并结算，返回评级/经验/金币/掉落' })
  async submit(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: SubmitDto,
  ): Promise<SessionFinish> {
    return this.sessions.submit(req.user.sub, Number.parseInt(id, 10), dto.answers);
  }
}