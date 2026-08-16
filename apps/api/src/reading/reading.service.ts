// 真题阅读：试卷/篇章列表、全文详情（句子/题目/词表/进度）、判分提交、进度保存、生词收集、点词查义
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReadingMarkWordRequest,
  ReadingMarkWordResponse,
  ReadingPaperSummary,
  ReadingPassageCode,
  ReadingPassageDetail,
  ReadingPassageStatus,
  ReadingPassageSummary,
  ReadingProgressUpdateRequest,
  ReadingSubmitAnswerInput,
  ReadingSubmitResponse,
  ReadingWordLookupResult,
} from '@word-journey/shared';
import {
  lookupReadingWord,
  normalizeReadingWord,
  readingWordCandidates,
  tokenizeReadingSentence,
} from '@word-journey/shared';
import type { ReadingSentenceStructure } from '@word-journey/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scoreReading } from './scoring';

// 每篇最多提交次数（防刷/防历史膨胀）
const MAX_SUBMISSIONS = 20;

@Injectable()
export class ReadingService {
  constructor(private readonly prisma: PrismaService) {}

  async papers(userId: number): Promise<ReadingPaperSummary[]> {
    const papers = await this.prisma.readingPaper.findMany({
      include: {
        passages: {
          include: { _count: { select: { questions: true } } },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { year: 'desc' },
    });
    const passageIds = papers.flatMap((p) => p.passages.map((pa) => pa.id));
    const progresses = passageIds.length
      ? await this.prisma.readingProgress.findMany({ where: { userId, passageId: { in: passageIds } } })
      : [];
    const progByPassage = new Map(progresses.map((p) => [p.passageId, p]));

    return papers.map((paper) => ({
      id: paper.id,
      year: paper.year,
      examName: paper.examName,
      passages: paper.passages.map((pa) => this.toPassageSummary(pa, progByPassage.get(pa.id))),
    }));
  }

  async passages(userId: number, paperId: number): Promise<ReadingPassageSummary[]> {
    const paper = await this.prisma.readingPaper.findUnique({ where: { id: paperId } });
    if (!paper) throw new NotFoundException('试卷不存在');
    const list = await this.prisma.readingPassage.findMany({
      where: { paperId },
      include: { _count: { select: { questions: true } } },
      orderBy: { order: 'asc' },
    });
    const progresses = await this.prisma.readingProgress.findMany({
      where: { userId, passageId: { in: list.map((p) => p.id) } },
    });
    const progByPassage = new Map(progresses.map((p) => [p.passageId, p]));
    return list.map((pa) => this.toPassageSummary(pa, progByPassage.get(pa.id)));
  }

  async detail(userId: number, passageId: number): Promise<ReadingPassageDetail> {
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

    const [progress, answers, savedWords, linkedProgress] = await Promise.all([
      this.prisma.readingProgress.findUnique({ where: { userId_passageId: { userId, passageId } } }),
      this.prisma.readingAnswer.findMany({ where: { userId, passageId } }),
      this.prisma.readingSavedWord.findMany({ where: { userId, passageId } }),
      (() => {
        const wordIds = passage.glossary.map((g) => g.wordId).filter((x): x is string => !!x);
        return wordIds.length
          ? this.prisma.userWordProgress.findMany({
              where: { userId, wordId: { in: wordIds } },
              select: { wordId: true, mastery: true, inVocabBook: true },
            })
          : Promise.resolve([]);
      })(),
    ]);

    const wordProg = new Map(linkedProgress.map((p) => [p.wordId, p]));
    const savedSet = new Set(savedWords.map((s) => s.word.toLowerCase()));

    const glossary = passage.glossary.map((g) => {
      const wp = g.wordId ? wordProg.get(g.wordId) : undefined;
      const saved = savedSet.has(g.word.toLowerCase());
      const inVocabBook = g.wordId ? !!(wp?.inVocabBook || saved) : saved;
      return {
        word: g.word,
        meaning: g.meaning,
        wordId: g.wordId ?? undefined,
        mastered: g.wordId ? (wp?.mastery ?? 0) >= 100 : undefined,
        inVocabBook,
      };
    });

    // 单词库掌握度：本篇出现的词（含屈折词形）→ 是否已掌握 + 档位（供"生词"标注判定）
    const passageTokens = new Set<string>();
    for (const s of passage.sentences) {
      for (const t of tokenizeReadingSentence(s.en)) if (t.word) passageTokens.add(normalizeReadingWord(t.word));
    }
    const bankWords = passageTokens.size
      ? await this.prisma.word.findMany({ where: { text: { in: [...passageTokens] } }, select: { id: true, text: true, tier: true } })
      : [];
    const bankProgress = bankWords.length
      ? await this.prisma.userWordProgress.findMany({
          where: { userId, wordId: { in: bankWords.map((w) => w.id) } },
          select: { wordId: true, mastery: true },
        })
      : [];
    const bankMastery = new Map(bankProgress.map((p) => [p.wordId, p.mastery]));
    const wordStatus: Record<string, { mastered: boolean; tier?: string }> = {};
    for (const w of bankWords) {
      wordStatus[w.text.toLowerCase()] = { mastered: (bankMastery.get(w.id) ?? 0) >= 100, tier: w.tier };
    }

    // 已答选择：取每题的最近一次作答
    const latest = new Map<number, { choice: string; at: number }>();
    for (const a of answers) {
      const cur = latest.get(a.seq);
      if (!cur || a.submittedAt.getTime() > cur.at) latest.set(a.seq, { choice: a.choice, at: a.submittedAt.getTime() });
    }
    const answered: Record<number, string> = {};
    for (const [seq, v] of latest) answered[seq] = v.choice;

    return {
      id: passage.id,
      paperId: passage.paperId,
      year: passage.paper.year,
      examName: passage.paper.examName,
      code: passage.code as ReadingPassageCode,
      title: passage.title,
      subtitle: passage.subtitle ?? undefined,
      questionsStart: passage.questionsStart,
      content: passage.content,
      translation: passage.translation,
      sentences: passage.sentences.map((s) => ({
        seq: s.seq,
        para: s.para,
        en: s.en,
        zh: s.zh,
        structure: (s.structure as ReadingSentenceStructure | null) ?? undefined,
      })),
      questions: passage.questions.map((q) => ({
        seq: q.seq,
        stem: q.stem,
        options: q.options as { A: string; B: string; C: string; D: string },
        remark: q.remark ?? undefined,
      })),
      glossary,
      wordStatus,
      progress: {
        status: (progress?.status ?? 'not-started') as ReadingPassageStatus,
        bestScore: progress?.bestScore ?? 0,
        totalQuestions: passage.questions.length,
        correctCount: Math.floor((progress?.bestScore ?? 0) / 2),
        currentSentence: progress?.currentSentence ?? 0,
        answered,
      },
      savedWords: savedWords.map((s) => s.word),
    };
  }

  async submit(
    userId: number,
    passageId: number,
    answers: ReadingSubmitAnswerInput[],
  ): Promise<ReadingSubmitResponse> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      include: { questions: { orderBy: { seq: 'asc' } } },
    });
    if (!passage) throw new NotFoundException('篇章不存在');

    const scored = scoreReading(
      answers,
      passage.questions.map((q) => ({
        seq: q.seq,
        stem: q.stem,
        options: q.options as { A: string; B: string; C: string; D: string },
        answer: q.answer,
        analysis: q.analysis,
      })),
    );
    const now = new Date();

    const prev = await this.prisma.readingProgress.findUnique({
      where: { userId_passageId: { userId, passageId } },
    });
    if ((prev?.submitCount ?? 0) >= MAX_SUBMISSIONS) {
      throw new BadRequestException(`提交次数已达上限（${MAX_SUBMISSIONS} 次）`);
    }
    const prevBest = prev?.bestScore ?? 0;
    const bestScore = Math.max(prevBest, scored.score);
    const recordBroken = scored.score > prevBest;

    // 全部答完 → done；否则 reading
    const allAnswered = await this.allAnswered(userId, passageId, passage.questions.length, answers);
    const status: ReadingPassageStatus = allAnswered ? 'done' : 'reading';

    await this.prisma.$transaction([
      this.prisma.readingAnswer.createMany({
        data: answers.map((a) => {
          const q = passage.questions.find((qq) => qq.seq === a.seq);
          return {
            userId,
            passageId,
            seq: a.seq,
            choice: a.choice,
            correct: q ? a.choice === q.answer : false,
            submittedAt: now,
          };
        }),
      }),
      this.prisma.readingProgress.upsert({
        where: { userId_passageId: { userId, passageId } },
        create: {
          userId,
          passageId,
          status,
          bestScore,
          totalQuestions: scored.totalQuestions,
          correctCount: Math.floor(bestScore / 2),
          currentSentence: prev?.currentSentence ?? 0,
          submitCount: 1,
          lastReadAt: now,
        },
        update: {
          status,
          bestScore,
          totalQuestions: scored.totalQuestions,
          correctCount: Math.floor(bestScore / 2),
          submitCount: { increment: 1 },
          lastReadAt: now,
        },
      }),
    ]);

    return {
      totalQuestions: scored.totalQuestions,
      correctCount: scored.correctCount,
      score: scored.score,
      results: scored.results,
      status,
      bestScore,
      recordBroken,
    };
  }

  async updateProgress(
    userId: number,
    passageId: number,
    body: ReadingProgressUpdateRequest,
  ): Promise<{ ok: true }> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      select: { id: true },
    });
    if (!passage) throw new NotFoundException('篇章不存在');

    const prev = await this.prisma.readingProgress.findUnique({
      where: { userId_passageId: { userId, passageId } },
    });
    const currentSentence = body.currentSentence ?? prev?.currentSentence ?? 0;
    const status = body.status ?? prev?.status ?? 'reading';

    await this.prisma.readingProgress.upsert({
      where: { userId_passageId: { userId, passageId } },
      create: {
        userId,
        passageId,
        status,
        bestScore: prev?.bestScore ?? 0,
        totalQuestions: prev?.totalQuestions ?? 0,
        correctCount: prev?.correctCount ?? 0,
        currentSentence,
        lastReadAt: new Date(),
      },
      update: { status, currentSentence, lastReadAt: new Date() },
    });
    return { ok: true };
  }

  async markWord(
    userId: number,
    passageId: number,
    body: ReadingMarkWordRequest,
  ): Promise<ReadingMarkWordResponse> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      include: { glossary: true },
    });
    if (!passage) throw new NotFoundException('篇章不存在');

    // 命中词表（含屈折回退），拿词义 / 关联 wordId
    const glossaryMap: Record<string, { word: string; meaning: string; wordId?: string }> = {};
    for (const g of passage.glossary) glossaryMap[g.word] = { word: g.word, meaning: g.meaning, wordId: g.wordId ?? undefined };
    const entry = lookupReadingWord(glossaryMap, body.word);
    const meaning = entry?.meaning ?? '';
    const wordId = entry?.wordId ?? null;

    const saved = body.action === 'save';
    if (saved) {
      await this.prisma.readingSavedWord.upsert({
        where: { userId_passageId_word: { userId, passageId, word: body.word } },
        create: { userId, passageId, word: body.word, meaning },
        update: { meaning },
      });
    } else {
      await this.prisma.readingSavedWord.deleteMany({ where: { userId, passageId, word: body.word } });
    }

    // 词库联动：同步图鉴生词本（inVocabBook）
    let inVocabBook: boolean | undefined;
    if (wordId) {
      if (saved) {
        await this.prisma.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId } },
          create: {
            userId,
            wordId,
            inVocabBook: true,
            firstEncounteredAt: new Date(),
            lastEncounteredAt: new Date(),
          },
          update: { inVocabBook: true, lastEncounteredAt: new Date() },
        });
      } else {
        await this.prisma.userWordProgress.updateMany({
          where: { userId, wordId },
          data: { inVocabBook: false },
        });
      }
      inVocabBook = saved;
    }

    const savedWords = (await this.prisma.readingSavedWord.findMany({
      where: { userId, passageId },
      select: { word: true },
    })).map((s) => s.word);

    return { word: body.word, saved, savedWords, inVocabBook };
  }

  // 点词查义：先查篇内词表，未命中则回退单词库（Word 总表，取首个义项）
  async lookupWord(userId: number, passageId: number, word: string): Promise<ReadingWordLookupResult> {
    const passage = await this.prisma.readingPassage.findUnique({
      where: { id: passageId },
      include: { glossary: true },
    });
    if (!passage) throw new NotFoundException('篇章不存在');

    // 1) 篇内词表（含屈折回退）
    const glossaryMap: Record<string, { word: string; meaning: string; wordId?: string; phonetic?: string }> = {};
    for (const g of passage.glossary) {
      glossaryMap[g.word] = { word: g.word, meaning: g.meaning, wordId: g.wordId ?? undefined };
    }
    const entry = lookupReadingWord(glossaryMap, word);
    if (entry) {
      return { found: true, source: 'glossary', word: entry.word, meaning: entry.meaning };
    }

    // 2) 回退单词库（MySQL 默认大小写不敏感；带屈折回退，支持复数/时态词形）
    for (const candidate of readingWordCandidates(word)) {
      const w = await this.prisma.word.findFirst({
        where: { text: candidate },
        include: { senses: { orderBy: { idx: 'asc' }, take: 1 } },
      });
      if (w && w.senses.length > 0) {
        return {
          found: true,
          source: 'wordbank',
          word: w.text,
          phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
          meaning: w.senses[0]?.meaning,
        };
      }
    }
    return { found: false };
  }

  // 是否已答完全部题目（并上本次提交的答案后去重计数）
  private async allAnswered(
    userId: number,
    passageId: number,
    total: number,
    incoming: ReadingSubmitAnswerInput[],
  ): Promise<boolean> {
    const rows = await this.prisma.readingAnswer.findMany({
      where: { userId, passageId },
      select: { seq: true, submittedAt: true },
    });
    const latest = new Map<number, number>();
    for (const r of rows) {
      const cur = latest.get(r.seq);
      if (cur === undefined || r.submittedAt.getTime() > cur) latest.set(r.seq, r.submittedAt.getTime());
    }
    const seqSet = new Set<number>(latest.keys());
    for (const a of incoming) seqSet.add(a.seq);
    return seqSet.size >= total;
  }

  private toPassageSummary(
    pa: { id: number; code: string; title: string; subtitle: string | null; _count: { questions: number } },
    prog: { status: string; bestScore: number } | undefined,
  ): ReadingPassageSummary {
    return {
      id: pa.id,
      code: pa.code as ReadingPassageCode,
      title: pa.title,
      subtitle: pa.subtitle ?? undefined,
      questionCount: pa._count.questions,
      status: (prog?.status ?? 'not-started') as ReadingPassageStatus,
      bestScore: prog?.bestScore ?? 0,
      correctCount: Math.floor((prog?.bestScore ?? 0) / 2),
      totalQuestions: pa._count.questions,
    };
  }
}
