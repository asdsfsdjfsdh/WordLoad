import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { FeedbackCreateInput, FeedbackListResult, FeedbackView } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { FeedbackService } from './feedback.service';

class CreateFeedbackDto implements FeedbackCreateInput {
  @IsIn(['suggestion', 'bug', 'other'])
  type!: 'suggestion' | 'bug' | 'other';

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contact?: string;
}

@ApiTags('feedback')
@Controller('feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: '提交意见 / Bug 反馈' })
  create(@Req() req: Request & { user: JwtUser }, @Body() dto: CreateFeedbackDto): Promise<FeedbackView> {
    return this.feedback.create(req.user.sub, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: '我的反馈列表' })
  listMine(@Req() req: Request & { user: JwtUser }): Promise<FeedbackListResult> {
    return this.feedback.listMine(req.user.sub);
  }
}
