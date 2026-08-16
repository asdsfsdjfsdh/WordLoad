// 后台管理服务：单词库 / 阅读库 编辑与修正
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminGlossaryUpdate,
  AdminPassageEdit,
  AdminQuestionUpdate,
  AdminSentenceUpdate,
  AdminWordCreateInput,
  AdminWordDetail,
  AdminWordListResult,
  AdminWordSaveInput,
  ReadingSentenceStructure,
} from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // 审计：记录管理操作（写接口统一调用）
  private async audit(
    adminId: number,
    action: 'save' | 'create' | 'delete',
    table: string,
    recordId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        table,
        recordId,
        before: (before as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        after: (after as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });
  }

  // ── 单词库 ──
  async listWords(q: string, tier: string | undefined, page: number, pageSize: number): Promise<AdminWordListResult> {
    const where: Record<string, unknown> = {};
    if (tier) where['tier'] = tier;
    if (q && q.trim()) {
      where['OR'] = [
        { text: { contains: q.trim() } },
        { senses: { some: { meaning: { contains: q.trim() } } } },
      ];
    }
    const [total, words] = await Promise.all([
      this.prisma.word.count({ where }),
      this.prisma.word.findMany({
        where,
        include: {
          _count: { select: { senses: true } },
          bankWords: { select: { stage: true, bank: { select: { code: true } } }, take: 1 },
        },
        orderBy: { text: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 阅读库词表引用标记
    const wordIds = words.map((w) => w.id);
    const texts = words.map((w) => w.text);
    const refs = wordIds.length
      ? await this.prisma.readingGlossary.findMany({
          where: { OR: [{ wordId: { in: wordIds } }, { word: { in: texts } }] },
          select: { wordId: true },
        })
      : [];
    const refWordIds = new Set(refs.map((r) => r.wordId).filter((x): x is string => !!x));

    return {
      total,
      items: words.map((w) => {
        const bw = w.bankWords[0];
        return {
          id: w.id,
          text: w.text,
          phoneticAm: w.phoneticAm ?? undefined,
          phoneticEn: w.phoneticEn ?? undefined,
          tier: w.tier as AdminWordListResult['items'][number]['tier'],
          stage: bw?.stage ?? null,
          bankCode: bw?.bank.code,
          senseCount: w._count.senses,
          inReadingGlossary: refWordIds.has(w.id) || refs.some((r) => r.wordId === null),
        };
      }),
    };
  }

  async getWord(id: string): Promise<AdminWordDetail> {
    const word = await this.prisma.word.findUnique({
      where: { id },
      include: {
        senses: { orderBy: { idx: 'asc' } },
        bankWords: { include: { bank: true }, orderBy: { stage: 'asc' } },
      },
    });
    if (!word) throw new NotFoundException('单词不存在');
    return {
      id: word.id,
      text: word.text,
      phoneticAm: word.phoneticAm ?? undefined,
      phoneticEn: word.phoneticEn ?? undefined,
      tier: word.tier as AdminWordDetail['tier'],
      difficultyScore: word.difficultyScore,
      mnemonic: word.mnemonic ?? undefined,
      senses: word.senses.map((s) => ({ id: s.id, idx: s.idx, meaning: s.meaning, example: s.example })),
      banks: word.bankWords.map((bw) => ({ bankId: bw.bankId, code: bw.bank.code, name: bw.bank.name, stage: bw.stage })),
    };
  }

  async saveWord(adminId: number, id: string, input: AdminWordSaveInput): Promise<AdminWordDetail> {
    const existing = await this.prisma.word.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('单词不存在');

    await this.prisma.$transaction([
      this.prisma.word.update({
        where: { id },
        data: {
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.phoneticAm !== undefined ? { phoneticAm: input.phoneticAm } : {}),
          ...(input.phoneticEn !== undefined ? { phoneticEn: input.phoneticEn } : {}),
          ...(input.tier !== undefined ? { tier: input.tier } : {}),
          ...(input.mnemonic !== undefined ? { mnemonic: input.mnemonic } : {}),
        },
      }),
      // 义项全量替换（用户进度按 wordId+senseIdx 追踪，重建安全）
      this.prisma.wordSense.deleteMany({ where: { wordId: id } }),
      this.prisma.wordSense.createMany({
        data: input.senses.map((s, i) => ({ wordId: id, idx: i, meaning: s.meaning, example: s.example })),
      }),
    ]);
    await this.audit(adminId, 'save', 'word', id, { text: existing.text }, { text: input.text ?? existing.text, senses: input.senses.length });
    return this.getWord(id);
  }

  async createWord(adminId: number, input: AdminWordCreateInput): Promise<AdminWordDetail> {
    const tier = input.tier ?? 'I';
    const word = await this.prisma.word.create({
      data: {
        text: input.text,
        phoneticAm: input.phoneticAm,
        phoneticEn: input.phoneticEn,
        difficultyScore: 3,
        tier,
        difficultyDims: {},
        senses: input.senses?.length
          ? { create: input.senses.map((s, i) => ({ idx: i, meaning: s.meaning, example: s.example })) }
          : undefined,
      },
    });
    if (input.bankCode && input.stage) {
      const bank = await this.prisma.wordBank.findUnique({ where: { code: input.bankCode } });
      if (bank) {
        await this.prisma.bankWord.upsert({
          where: { bankId_wordId: { bankId: bank.id, wordId: word.id } },
          update: { stage: input.stage },
          create: { bankId: bank.id, wordId: word.id, stage: input.stage },
        });
      }
    }
    await this.audit(adminId, 'create', 'word', word.id, undefined, { text: word.text, tier, senses: input.senses?.length ?? 0 });
    return this.getWord(word.id);
  }

  async deleteWord(adminId: number, id: string): Promise<{ ok: true }> {
    const word = await this.prisma.word.findUnique({ where: { id } });
    if (!word) throw new NotFoundException('单词不存在');
    const [prog, senseProg, runItems, sessionItems] = await Promise.all([
      this.prisma.userWordProgress.count({ where: { wordId: id } }),
      this.prisma.userSenseProgress.count({ where: { wordId: id } }),
      this.prisma.runItem.count({ where: { wordId: id } }),
      this.prisma.learningSessionItem.count({ where: { wordId: id } }),
    ]);
    if (prog + senseProg + runItems + sessionItems > 0) {
      throw new ConflictException('该词已被用户学习/答题记录引用，禁止删除（可改用编辑修正）');
    }
    await this.prisma.$transaction([
      this.prisma.bankWord.deleteMany({ where: { wordId: id } }),
      this.prisma.wordPair.deleteMany({ where: { OR: [{ wordAId: id }, { wordBId: id }] } }),
      this.prisma.word.delete({ where: { id } }),
    ]);
    await this.audit(adminId, 'delete', 'word', id, { text: word.text });
    return { ok: true };
  }

  // ── 阅读库 ──
  async listReadingPapers(): Promise<{ id: number; year: number; examName: string; passages: { id: number; code: string; title: string; order: number }[] }[]> {
    const papers = await this.prisma.readingPaper.findMany({
      include: { passages: { orderBy: { order: 'asc' }, select: { id: true, code: true, title: true, order: true } } },
      orderBy: { year: 'desc' },
    });
    return papers;
  }

  async getPassage(passageId: number): Promise<AdminPassageEdit> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      include: {
        paper: true,
        sentences: { orderBy: { seq: 'asc' } },
        questions: { orderBy: { seq: 'asc' } },
        glossary: true,
      },
    });
    if (!passage) throw new NotFoundException('篇章不存在');
    return {
      id: passage.id,
      paperYear: passage.paper.year,
      examName: passage.paper.examName,
      code: passage.code as AdminPassageEdit['code'],
      title: passage.title,
      subtitle: passage.subtitle ?? undefined,
      questionsStart: passage.questionsStart,
      content: passage.content,
      translation: passage.translation,
      sentences: passage.sentences.map((s) => ({
        id: s.id,
        seq: s.seq,
        para: s.para,
        en: s.en,
        zh: s.zh,
        structure: (s.structure as ReadingSentenceStructure | null) ?? undefined,
      })),
      questions: passage.questions.map((q) => ({
        id: q.id,
        seq: q.seq,
        stem: q.stem,
        options: q.options as AdminPassageEdit['questions'][number]['options'],
        answer: q.answer,
        analysis: q.analysis,
        remark: q.remark ?? undefined,
      })),
      glossary: passage.glossary.map((g) => ({
        id: g.id,
        word: g.word,
        meaning: g.meaning,
        wordId: g.wordId ?? undefined,
      })),
    };
  }

  async savePassageMeta(adminId: number, passageId: number, input: { title?: string; subtitle?: string | null }): Promise<{ ok: true }> {
    const exists = await this.prisma.readingPassage.findUnique({ where: { id: passageId }, select: { id: true, title: true } });
    if (!exists) throw new NotFoundException('篇章不存在');
    await this.prisma.readingPassage.update({
      where: { id: passageId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingPassage', String(passageId), { title: exists.title }, { title: input.title ?? exists.title });
    return { ok: true };
  }

  async saveSentence(adminId: number, id: number, input: AdminSentenceUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingSentence.findUnique({ where: { id }, select: { id: true, en: true } });
    if (!exists) throw new NotFoundException('句子不存在');
    const data: Prisma.ReadingSentenceUpdateInput = {};
    if (input.en !== undefined) data.en = input.en;
    if (input.zh !== undefined) data.zh = input.zh;
    if (input.structure !== undefined) {
      data.structure = input.structure === null ? Prisma.DbNull : (input.structure as unknown as Prisma.InputJsonValue);
    }
    await this.prisma.readingSentence.update({ where: { id }, data });
    await this.audit(adminId, 'save', 'readingSentence', String(id), { en: exists.en }, { en: input.en ?? exists.en });
    return { ok: true };
  }

  async saveQuestion(adminId: number, id: number, input: AdminQuestionUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingQuestion.findUnique({ where: { id }, select: { id: true, answer: true } });
    if (!exists) throw new NotFoundException('题目不存在');
    await this.prisma.readingQuestion.update({
      where: { id },
      data: {
        ...(input.stem !== undefined ? { stem: input.stem } : {}),
        ...(input.options !== undefined ? { options: input.options } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.analysis !== undefined ? { analysis: input.analysis } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingQuestion', String(id), { answer: exists.answer }, { answer: input.answer ?? exists.answer });
    return { ok: true };
  }

  async saveGlossary(adminId: number, id: number, input: AdminGlossaryUpdate): Promise<{ ok: true }> {
    const exists = await this.prisma.readingGlossary.findUnique({ where: { id }, select: { id: true, word: true } });
    if (!exists) throw new NotFoundException('词表条目不存在');
    await this.prisma.readingGlossary.update({
      where: { id },
      data: {
        ...(input.word !== undefined ? { word: input.word } : {}),
        ...(input.meaning !== undefined ? { meaning: input.meaning } : {}),
      },
    });
    await this.audit(adminId, 'save', 'readingGlossary', String(id), { word: exists.word }, { word: input.word ?? exists.word });
    return { ok: true };
  }
}
