// 管理员守卫：配合 JwtAuthGuard 使用（JwtAuthGuard 先挂载 req.user）
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { sub: number } }>();
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException('需要登录');
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
    if (!u?.isAdmin) throw new ForbiddenException('无管理员权限');
    return true;
  }
}
