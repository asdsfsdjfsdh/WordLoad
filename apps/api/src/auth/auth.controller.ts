import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthTokens, AuthUser } from '@word-journey/shared';
import { InitCharDto, LoginDto, RefreshDto, RegisterDto, StrengthenDto } from './dto';
import { JwtAuthGuard, type JwtUser } from './jwt-auth.guard';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: '注册并返回 token' })
  register(@Body() dto: RegisterDto): Promise<AuthTokens & { user: AuthUser }> {
    return this.auth.register(dto.username, dto.password);
  }

  @Post('login')
  @ApiOperation({ summary: '登录并返回 token' })
  login(@Body() dto: LoginDto): Promise<AuthTokens & { user: AuthUser }> {
    return this.auth.login(dto.username, dto.password);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'refresh 轮换：换取新 access + 新 refresh' })
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '当前用户信息' })
  me(@Req() req: Request & { user: JwtUser }): Promise<AuthUser> {
    return this.auth.me(req.user.sub);
  }

  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '退出登录：使已签发 refresh token 服务端失效' })
  logout(@Req() req: Request & { user: JwtUser }): Promise<{ ok: boolean }> {
    return this.auth.logout(req.user.sub);
  }

  @Post('character')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '初始化角色三围（仅首次，默认 1 级）' })
  initCharacter(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: InitCharDto,
  ): Promise<AuthUser> {
    return this.auth.initCharacter(req.user.sub, dto.hpLv, dto.atkLv, dto.defLv);
  }

  @Post('strengthen')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '强化三围（消耗金币 + tier1 材料）' })
  strengthen(
    @Req() req: Request & { user: JwtUser },
    @Body() dto: StrengthenDto,
  ): Promise<AuthUser> {
    return this.auth.strengthen(req.user.sub, dto.stat);
  }
}