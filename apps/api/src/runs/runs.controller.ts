import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { ActiveRunResponse, BackupWordsResult, CreateRunResponse, ReplenishResult, RerollRunResponse, RunAdvanceResponse, RunFinish } from '@word-journey/shared';
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

  // 缺省 'unit'（红宝书 Unit 肉鸽）；'survival' 旧生存 Run 入口已移除，仅供后端休眠保留
  @IsOptional()
  @IsIn(['unit', 'survival'])
  kind?: string;
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

  // 幂等守卫：须与 run.day 一致，否则拒绝（防止重复提交/过期覆盖）
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedDay?: number;

  // 客户端累计游玩时长（秒）：服务端取 max 持久化，结算展示
  @IsOptional()
  @IsInt()
  @Min(0)
  playSeconds?: number;
}

class FinishDto {
  @IsBoolean()
  surrender!: boolean;

  // 客户端累计游玩时长（秒）：服务端取 max 持久化，结算展示
  @IsOptional()
  @IsInt()
  @Min(0)
  playSeconds?: number;
}

class ReplenishDto {
  @IsOptional()
  @IsString()
  wordId?: string;
}

class BackupWordsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @IsString()
  exclude?: string; // 逗号分隔的已排除 wordId
}

@ApiTags('runs')
@Controller('runs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post()
  @ApiOperation({ summary: '创建 Run（缺省 unit=红宝书 Unit 肉鸽；自动收枪同 kind 旧 Run）' })
  async create(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: CreateRunDto,
  ): Promise<CreateRunResponse> {
    return this.runs.create(req.user.sub, {
      bankCode: dto.bankCode,
      stageId: dto.stageId,
      mode: dto.mode as 'zh2en' | 'dictation' | 'choice',
      kind: dto.kind as 'unit' | 'survival' | undefined,
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdvanceDto,
  ): Promise<RunAdvanceResponse> {
    return this.runs.advance(req.user.sub, id, dto);
  }

  @Post(':id/replenish')
  @ApiOperation({ summary: '预览斩词后补词：挑未掌握的新词加入本波待答题（可指定候补词）' })
  async replenish(
    @Req() req: Request & { user: JwtUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplenishDto,
  ): Promise<ReplenishResult | null> {
    return this.runs.replenish(req.user.sub, id, { wordId: dto.wordId });
  }

  @Get(':id/backup-words')
  @ApiOperation({ summary: '预习候补词池批量预取：返回一批未用新词候选（不落库）' })
  async backupWords(
    @Req() req: Request & { user: JwtUser },
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BackupWordsDto,
  ): Promise<BackupWordsResult> {
    const exclude = query.exclude
      ? query.exclude.split(',').filter(Boolean)
      : [];
    return this.runs.backupWords(req.user.sub, id, { count: query.count, exclude });
  }

  @Post(':id/reroll')
  @ApiOperation({ summary: '金币重抽增益：每波限 1 次，重新生成三选一' })
  async reroll(
    @Req() req: Request & { user: JwtUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RerollRunResponse> {
    return this.runs.reroll(req.user.sub, id);
  }

  @Post(':id/finish')
  @ApiOperation({ summary: '主动收枪：结算生存 Run' })
  async finish(
    @Req() req: Request & { user: JwtUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FinishDto,
  ): Promise<RunFinish> {
    return this.runs.finish(req.user.sub, id, dto);
  }
}