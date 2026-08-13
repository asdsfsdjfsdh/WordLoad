import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';
import type { Request } from 'express';
import type { SynthesizeResult } from '@word-journey/shared';
import { JwtAuthGuard, type JwtUser } from '../auth/jwt-auth.guard';
import { MaterialsService } from './materials.service';

class SynthesizeDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 3])
  fromTier!: 1 | 2 | 3;
}

@ApiTags('materials')
@Controller('materials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Post('synthesize')
  @ApiOperation({ summary: '合成：3×tierN → 1×tier(N+1)，扣 20·N 金币' })
  async synthesize(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: SynthesizeDto,
  ): Promise<SynthesizeResult> {
    return this.materials.synthesize(req.user.sub, dto.fromTier);
  }
}