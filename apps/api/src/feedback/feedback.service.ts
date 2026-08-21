import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminFeedbackListResult,
  AdminFeedbackReplyInput,
  FeedbackCreateInput,
  FeedbackListResult,
  FeedbackStatus,
  FeedbackView,
} from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

interface FeedbackRow {
  id: number;
  type: string;
  content: string;
  contact: string | null;
  status: string;
  reply: string | null;
  createdAt: Date;
  repliedAt: Date | null;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: number, input: FeedbackCreateInput): Promise<FeedbackView> {
    const f = await this.prisma.feedback.create({
      data: { userId, type: input.type, content: input.content, contact: input.contact ?? null },
    });
    return this.toView(f);
  }

  async listMine(userId: number): Promise<FeedbackListResult> {
    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.feedback.count({ where: { userId } }),
    ]);
    return { items: items.map((f) => this.toView(f)), total };
  }

  async listAdmin(filter: { status?: string; type?: string }, page: number, pageSize: number): Promise<AdminFeedbackListResult> {
    const where: Record<string, unknown> = {};
    if (filter.status) where['status'] = filter.status;
    if (filter.type) where['type'] = filter.type;
    const [total, openCount, items] = await Promise.all([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.count({ where: { status: 'open' } }),
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { username: true } } },
      }),
    ]);
    return {
      total,
      openCount,
      items: items.map((f) => ({ ...this.toView(f), userId: f.userId, username: f.user.username })),
    };
  }

  async reply(id: number, input: AdminFeedbackReplyInput): Promise<AdminFeedbackListResult['items'][number]> {
    const f = await this.prisma.feedback.findUnique({ where: { id }, include: { user: { select: { username: true } } } });
    if (!f) throw new NotFoundException('反馈不存在');
    const updated = await this.prisma.feedback.update({
      where: { id },
      data: { status: input.status, reply: input.reply ?? null, repliedAt: new Date() },
      include: { user: { select: { username: true } } },
    });
    return { ...this.toView(updated), userId: updated.userId, username: updated.user.username };
  }

  private toView(f: FeedbackRow): FeedbackView {
    return {
      id: f.id,
      type: f.type as FeedbackView['type'],
      content: f.content,
      contact: f.contact ?? undefined,
      status: f.status as FeedbackStatus,
      reply: f.reply ?? undefined,
      createdAt: f.createdAt.toISOString(),
      repliedAt: f.repliedAt?.toISOString(),
    };
  }
}
