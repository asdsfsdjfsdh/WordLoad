import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // 重置全部学习进度：清空词级进度 / 义项级进度 / 会话（含逐题记录）
  // 保留：金币、角色等级与属性、词书与单词数据
  async resetProgress(userId: number): Promise<{ ok: boolean }> {
    await this.prisma.$transaction([
      this.prisma.userWordProgress.deleteMany({ where: { userId } }),
      this.prisma.userSenseProgress.deleteMany({ where: { userId } }),
      // LearningSessionItem 通过 onDelete: Cascade 随会话自动删除
      this.prisma.learningSession.deleteMany({ where: { userId } }),
    ]);
    return { ok: true };
  }
}