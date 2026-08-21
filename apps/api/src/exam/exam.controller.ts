import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import type { ExamPaper, ExamSubmitResult } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { ExamService } from './exam.service';

class ExamAnswerDto {
  @IsInt()
  @Min(0)
  seq!: number;

  @IsString()
  typed!: string;

  @IsNumber()
  @Min(0)
  elapsedMs!: number;
}

class ExamSubmitDto {
  @IsString()
  paperId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamAnswerDto)
  answers!: ExamAnswerDto[];
}

@ApiTags('exam')
@Controller('exam')
export class ExamController {
  constructor(private readonly exam: ExamService) {}

  // 出卷：GET /exam/:bankCode/:stageId
  @Get(':bankCode/:stageId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '生成 Unit 试卷（看中填英，标注词性，不标注音标）' })
  async buildPaper(
    @Req() req: Request & { user: JwtUser },
    @Param('bankCode') bankCode: string,
    @Param('stageId', ParseIntPipe) stageId: number,
  ): Promise<ExamPaper> {
    return this.exam.buildPaper(req.user.sub, { bankCode, stageId });
  }

  // 交卷批改：POST /exam/:bankCode/:stageId/submit
  @Post(':bankCode/:stageId/submit')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '交卷自动批改，返回批改后卷面并计入统计' })
  async submit(
    @Req() req: Request & { user: JwtUser },
    @Param('bankCode') bankCode: string,
    @Param('stageId', ParseIntPipe) stageId: number,
    @Body() body: ExamSubmitDto,
  ): Promise<ExamSubmitResult> {
    return this.exam.submit(req.user.sub, {
      bankCode,
      stageId,
      paperId: body.paperId,
      answers: body.answers,
    });
  }
}
