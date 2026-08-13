import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { ActiveRunResponse, CreateRunResponse, RunAdvanceResponse, RunFinish } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { RunsService } from './runs.service';

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

class CreateRunDto {
  @IsString()
  bankCode!: string;

  @IsInt()
  @Min(1)
  stageId!: number;

  @IsString()
  @IsIn(['zh2en', 'dictation', 'choice'])
  mode!: string;
}

class AdvanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];

  @IsOptional()
  @IsString()
  buffChoice?: string;

  @IsOptional()
  @IsString()
  legendChoice?: string;

  // 客户端权威：前端实时模拟出的波末血量（缺省回退 run.hp）
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalHp?: number;

  // Boss 波：是否击破首领
  @IsOptional()
  @IsBoolean()
  bossCleared?: boolean;
}

class FinishDto {
  @IsBoolean()
  surrender!: boolean;
}

@ApiTags('runs')
@Controller('runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post()
  @ApiOperation({ summary: '创建生存 Run（自动收枪旧 Run）' })
  async create(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateRunDto,
  ): Promise<CreateRunResponse> {
    return this.runs.create(req.user.sub, {
      bankCode: dto.bankCode,
      stageId: dto.stageId,
      mode: dto.mode as 'zh2en' | 'dictation' | 'choice',
    });
  }

  @Get('active')
  @ApiOperation({ summary: '续 Run：返回当前未答题' })
  async getActive(@Req() req: Request & { user: JwtUser }): Promise<ActiveRunResponse | null> {
    return this.runs.getActive(req.user.sub);
  }

  @Post(':id/advance')
  @ApiOperation({ summary: '波末推进：重放战场 → 注入 → 下一波题（含首领波）' })
  async advance(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: AdvanceDto,
  ): Promise<RunAdvanceResponse> {
    return this.runs.advance(req.user.sub, Number.parseInt(id, 10), dto);
  }

  @Post(':id/finish')
  @ApiOperation({ summary: '主动收枪：结算生存 Run' })
  async finish(
    @Req() req: Request & { user: JwtUser },
    @Param('id') id: string,
    @Body() dto: FinishDto,
  ): Promise<RunFinish> {
    return this.runs.finish(req.user.sub, Number.parseInt(id, 10), dto);
  }
}