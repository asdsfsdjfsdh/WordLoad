// 后台管理控制器
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type {
  AdminAuditLogListResult,
  AdminFeedbackListResult,
  AdminPassageEdit,
  AdminStatsOverview,
  AdminUserDetail,
  AdminUserListResult,
  AdminWordCreateInput,
  AdminWordDetail,
  AdminWordListResult,
  AdminWordSaveInput,
} from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeedbackService } from '../feedback/feedback.service';

// ── 单词库 DTO ──
class WordSenseDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  meaning!: string;

  @IsString()
  example!: string;
}

class SaveWordDto implements AdminWordSaveInput {
  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  phoneticAm?: string | null;

  @IsOptional()
  @IsString()
  phoneticEn?: string | null;

  @IsOptional()
  @IsIn(['I', 'II', 'III', 'IV'])
  tier?: 'I' | 'II' | 'III' | 'IV';

  @IsOptional()
  @IsString()
  mnemonic?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordSenseDto)
  senses!: WordSenseDto[];
}

class CreateWordDto implements AdminWordCreateInput {
  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  phoneticAm?: string;

  @IsOptional()
  @IsString()
  phoneticEn?: string;

  @IsOptional()
  @IsIn(['I', 'II', 'III', 'IV'])
  tier?: 'I' | 'II' | 'III' | 'IV';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordSenseDto)
  senses?: { meaning: string; example: string }[];

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  stage?: number;
}

// ── 阅读库 DTO ──
class PassageMetaDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  subtitle?: string | null;
}

class SentenceDto {
  @IsOptional()
  @IsString()
  en?: string;

  @IsOptional()
  @IsString()
  zh?: string;

  @IsOptional()
  @IsObject()
  structure?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  knowledge?: Record<string, unknown> | null;
}

class QuestionDto {
  @IsOptional()
  @IsString()
  stem?: string;

  @IsOptional()
  @IsObject()
  options?: { A: string; B: string; C: string; D: string };

  @IsOptional()
  @IsIn(['A', 'B', 'C', 'D'])
  answer?: string;

  @IsOptional()
  @IsString()
  analysis?: string;
}

class GlossaryDto {
  @IsOptional()
  @IsString()
  word?: string;

  @IsOptional()
  @IsString()
  meaning?: string;
}

class SetAdminDto {
  @IsBoolean()
  isAdmin!: boolean;
}

class SetFeedbackDto {
  @IsIn(['open', 'done', 'ignored'])
  status!: 'open' | 'done' | 'ignored';

  @IsOptional()
  @IsString()
  reply?: string;
}

@ApiTags('admin')
@Controller('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly feedback: FeedbackService,
  ) {}

  // 单词库
  @Get('words')
  @ApiOperation({ summary: '单词列表（搜索/筛选/分页）' })
  listWords(
    @Query('q') q = '',
    @Query('tier') tier?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<AdminWordListResult> {
    return this.admin.listWords(q, tier, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(pageSize) || 20)));
  }

  @Get('words/:id')
  @ApiOperation({ summary: '单词详情（编辑用）' })
  getWord(@Param('id') id: string): Promise<AdminWordDetail> {
    return this.admin.getWord(id);
  }

  @Post('words/:id')
  @ApiOperation({ summary: '保存单词（字段 + 义项全量替换）' })
  saveWord(@Req() req: Request & { user: JwtUser }, @Param('id') id: string, @Body() dto: SaveWordDto): Promise<AdminWordDetail> {
    return this.admin.saveWord(req.user.sub, id, dto);
  }

  @Post('words')
  @ApiOperation({ summary: '新建单词' })
  createWord(@Req() req: Request & { user: JwtUser }, @Body() dto: CreateWordDto): Promise<AdminWordDetail> {
    return this.admin.createWord(req.user.sub, dto);
  }

  @Delete('words/:id')
  @ApiOperation({ summary: '删除单词（被用户记录引用时拒绝）' })
  deleteWord(@Req() req: Request & { user: JwtUser }, @Param('id') id: string): Promise<{ ok: true }> {
    return this.admin.deleteWord(req.user.sub, id);
  }

  // 阅读库
  @Get('reading/papers')
  @ApiOperation({ summary: '阅读卷列表' })
  listReadingPapers() {
    return this.admin.listReadingPapers();
  }

  @Get('reading/passages/:id')
  @ApiOperation({ summary: '篇章完整数据（句子/题目/词表，编辑用）' })
  getPassage(@Param('id', ParseIntPipe) id: number): Promise<AdminPassageEdit> {
    return this.admin.getPassage(id);
  }

  @Put('reading/passages/:id')
  @ApiOperation({ summary: '更新篇章标题/副标题' })
  savePassageMeta(@Req() req: Request & { user: JwtUser }, @Param('id', ParseIntPipe) id: number, @Body() dto: PassageMetaDto) {
    return this.admin.savePassageMeta(req.user.sub, id, dto);
  }

  @Put('reading/sentences/:id')
  @ApiOperation({ summary: '更新句子（英文/译文/结构/知识点）' })
  saveSentence(@Req() req: Request & { user: JwtUser }, @Param('id', ParseIntPipe) id: number, @Body() dto: SentenceDto) {
    return this.admin.saveSentence(req.user.sub, id, {
      en: dto.en,
      zh: dto.zh,
      structure: dto.structure as import('@word-journey/shared').ReadingSentenceStructure | null,
      knowledge: dto.knowledge as import('@word-journey/shared').ReadingSentenceKnowledge | null,
    });
  }

  @Put('reading/questions/:id')
  @ApiOperation({ summary: '更新题目' })
  saveQuestion(@Req() req: Request & { user: JwtUser }, @Param('id', ParseIntPipe) id: number, @Body() dto: QuestionDto) {
    return this.admin.saveQuestion(req.user.sub, id, dto);
  }

  @Put('reading/glossary/:id')
  @ApiOperation({ summary: '更新词表条目' })
  saveGlossary(@Req() req: Request & { user: JwtUser }, @Param('id', ParseIntPipe) id: number, @Body() dto: GlossaryDto) {
    return this.admin.saveGlossary(req.user.sub, id, dto);
  }

  // ── 运营总览 ──
  @Get('stats/overview')
  @ApiOperation({ summary: '运营数据总览' })
  statsOverview(): Promise<AdminStatsOverview> {
    return this.admin.getStatsOverview();
  }

  @Get('stats/trend')
  @ApiOperation({ summary: '运营趋势（近 N 天逐日，默认 14）' })
  statsTrend(@Query('days') days = '14'): Promise<import('@word-journey/shared').AdminStatsTrend> {
    return this.admin.getStatsTrend(Number(days) || 14);
  }

  // ── 用户管理 ──
  @Get('users')
  @ApiOperation({ summary: '用户列表（搜索/分页）' })
  listUsers(
    @Query('q') q = '',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<AdminUserListResult> {
    return this.admin.listUsers(q, Math.max(1, Number(page) || 1), Math.min(100, Math.max(1, Number(pageSize) || 20)));
  }

  @Get('users/:id')
  @ApiOperation({ summary: '用户详情' })
  getUserDetail(@Param('id', ParseIntPipe) id: number): Promise<AdminUserDetail> {
    return this.admin.getUserDetail(id);
  }

  @Put('users/:id/admin')
  @ApiOperation({ summary: '设置 / 取消管理员' })
  setUserAdmin(@Req() req: Request & { user: JwtUser }, @Param('id', ParseIntPipe) id: number, @Body() dto: SetAdminDto) {
    return this.admin.setUserAdmin(req.user.sub, id, dto.isAdmin);
  }

  // ── 审计日志 ──
  @Get('audit-logs')
  @ApiOperation({ summary: '审计日志（筛选/分页）' })
  listAuditLogs(
    @Query('table') table?: string,
    @Query('action') action?: string,
    @Query('admin') adminUsername?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<AdminAuditLogListResult> {
    return this.admin.listAuditLogs(
      { table, action, adminUsername },
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(pageSize) || 20)),
    );
  }

  // ── 反馈管理 ──
  @Get('feedback')
  @ApiOperation({ summary: '反馈列表（筛选/分页）' })
  listFeedback(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ): Promise<AdminFeedbackListResult> {
    return this.feedback.listAdmin(
      { status, type },
      Math.max(1, Number(page) || 1),
      Math.min(100, Math.max(1, Number(pageSize) || 20)),
    );
  }

  @Post('feedback/:id/reply')
  @ApiOperation({ summary: '回复 / 更新反馈状态' })
  replyFeedback(@Param('id', ParseIntPipe) id: number, @Body() dto: SetFeedbackDto) {
    return this.feedback.reply(id, dto);
  }
}

