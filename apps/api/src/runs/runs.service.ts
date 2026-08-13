// 生存 Run 服务：创建 / 续 Run / 波末推进 / 结算
// 核心原则：服务端权威 — typed 比对判定、吸血/扣血/注入/Boss 全在服务端重放
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActiveRunResponse,
  CreateRunResponse,
  DifficultyTier,
  GameMode,
  LevelWord,
  RunAdvanceResponse,
  RunFinish,
  RunInfo,
  RunQuestion,
} from '@word-journey/shared';
import {
  SURVIVAL,
  applyDef,
  atkMult,
  bossHits,
  injectAmount,
  leechN,
  materialTierAt,
  monsterHits,
  travelBudget,
} from '@word-journey/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildQuestion } from '../questions/question-builder';
import { shouldTriggerBoss } from './boss-trigger';
import {
  computeRating,
  intervalDays,
  ratingExp,
  rollDrops,
  srsSchedule,
} from '../sessions/settlement';

interface BuffState {
  maxHp: number;
  leech: number;
  dmg: number;
  dodge: number;
  freeze: number;
}

interface BattleResult {
  hp: number;
  correct: number;
  wrong: number;
  leaked: number;
  stuns: number;
}

// 候选 buff 池（普通三选一 / 传说三选一）
const NORMAL_BUFFS = ['maxhp', 'dmg', 'leech', 'freeze', 'dodge'] as const;
const LEGEND_BUFFS = ['boss-immunity', 'kill-heal', 'boss-x2', 'no-leak-dmg'] as const;

interface DayItemInput {
  seq: number;
  wordId: string;
  senseIdx: number;
  type: string;
}

interface WordRow {
  id: string;
  text: string;
  phoneticAm: string | null;
  phoneticEn: string | null;
  tier: string;
  senses: { idx: number; meaning: string; example: string }[];
}

@Injectable()
export class RunsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 创建 Run ──
  async create(
    userId: number,
    opts: { bankCode: string; stageId: number; mode: GameMode },
  ): Promise<CreateRunResponse> {
    const bank = await this.prisma.wordBank.findUnique({ where: { code: opts.bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${opts.bankCode}`);

    // 全局仅一个 active Run：已有 → 自动收枪结算旧 Run
    await this.closeActive(userId);

    const character = await this.prisma.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');
    const hpLv = character.hpLv;
    const maxHp = SURVIVAL.MAX_HP_BASE + SURVIVAL.HP_PER_LV * hpLv;

    // 首日：全部新词（阶段词池）
    const pool = await this.stagePool(bank.id, opts.stageId);
    const injectedNew = Math.min(SURVIVAL.QUESTIONS_PER_DAY, pool.length);
    const dayWords = pool.slice(0, injectedNew);
    if (dayWords.length === 0) throw new BadRequestException('阶段无词可战');

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.run.create({
        data: {
          userId,
          bankId: bank.id,
          stageId: opts.stageId,
          mode: opts.mode,
          hp: maxHp,
          maxHp,
          buffs: [],
          lastInjectDay: 1,
          status: 'active',
        },
      });
      await tx.runItem.createMany({
        data: dayWords.map((w, seq) => ({
          runId: created.id,
          seq,
          wordId: w.wordId,
          senseIdx: 0,
          type: 'new',
        })),
      });
      return created;
    });

    const questions = await this.buildDayQuestions(run.id, run.mode as GameMode, dayWords, 'new', 0);
    return {
      run: toRunInfo(run),
      day: 1,
      hp: maxHp,
      maxHp,
      questions,
      previewWords: dayWords.map((w) => toLevelWord(w.word)),
      injectedNew,
    };
  }

  // ── 续 Run ──
  async getActive(userId: number): Promise<ActiveRunResponse | null> {
    const run = await this.prisma.run.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;

    const pending = await this.prisma.runItem.findMany({
      where: { runId: run.id, answered: false },
      orderBy: { seq: 'asc' },
    });
    if (pending.length === 0) {
      // 当前波已答完但未 advance：直接推进（无答案，视作重开日）
      const adv = await this.advance(userId, run.id, { answers: [] });
      return {
        run: toRunInfo(run),
        questions: adv.questions,
        previewWords: adv.previewWords,
        injectedNew: adv.injectedNew,
        ended: false,
      };
    }

    const wordRows = await this.loadWords(pending.map((i) => i.wordId));
    const questions: RunQuestion[] = pending.map((it) => {
      const w = wordRows.get(it.wordId);
      const q = buildQuestion({
        seq: it.seq,
        wordId: it.wordId,
        senseIdx: it.senseIdx,
        text: w?.text ?? '',
        promptBase:
          run.mode === 'dictation'
            ? (w?.phoneticAm ?? w?.phoneticEn ?? '')
            : (w?.senses[it.senseIdx]?.meaning ?? w?.text ?? ''),
        example: w?.senses[it.senseIdx]?.example,
        phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
        tier: (w?.tier ?? 'I') as DifficultyTier,
        mode: run.mode as GameMode,
        source: it.type === 'boss' ? 'boss' : it.type === 'new' ? 'new' : 'review',
      });
      return { ...q, isNew: it.type === 'new' };
    });

    return {
      run: toRunInfo(run),
      questions,
      previewWords: [],
      injectedNew: 0,
      ended: false,
    };
  }

  // ── 波末推进 ──
  async advance(
    userId: number,
    runId: number,
    opts: { answers: { seq: number; correct: boolean; elapsedMs: number; typed?: string }[]; buffChoice?: string },
  ): Promise<RunAdvanceResponse> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId, status: 'active' },
      include: { items: { orderBy: { seq: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Run 不存在或已结束');

    const character = await this.prisma.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');
    const hpLv = character.hpLv;
    const atkLv = character.atkLv;
    const defLv = character.defLv;
    const buffs = parseBuffs(run.buffs);

    // 应用玩家选择的 buff（上一波返回的候选之一），作用于本波回放
    if (opts.buffChoice) {
      const applied = applyBuffChoice(run, buffs, opts.buffChoice);
      if (applied) {
        await this.prisma.run.update({
          where: { id: run.id },
          data: { buffs: run.buffs as string[], maxHp: run.maxHp },
        });
      }
    }

    const wordRows = await this.loadWords([...new Set(run.items.map((i) => i.wordId))]);
    const answerBySeq = new Map(opts.answers.map((a) => [a.seq, a]));

    const resolveCorrect = (item: { wordId: string; seq: number }): boolean => {
      const a = answerBySeq.get(item.seq);
      const typed = a?.typed;
      if (typed !== undefined && typed !== null && typed !== '') {
        const truth = wordRows.get(item.wordId)?.text ?? '';
        return typed.trim().toLowerCase() === truth.trim().toLowerCase();
      }
      return a?.correct ?? false;
    };

    const isBossWave = run.items.some((i) => !i.answered && i.type === 'boss');

    // ── Boss 波结算 ──
    if (isBossWave) {
      const bossItems = run.items.filter((i) => !i.answered && i.type === 'boss');
      const bh = bossHits(run.day, atkLv);
      let bossHp = bh;
      let bossDmgTotal = 0;
      let correct = 0;

      for (const item of bossItems) {
        const ok = resolveCorrect(item);
        if (ok) {
          correct++;
          bossHp -= 1;
        } else {
          const raw = Math.min(
            SURVIVAL.BOSS_DMG_BASE + SURVIVAL.BOSS_DMG_GROW * (run.day - 1),
            SURVIVAL.BOSS_DMG_CAP,
          );
          bossDmgTotal += applyDef(raw, defLv);
        }
      }

      await this.persistAnswers(
        bossItems.map((i) => ({
          id: i.id,
          correct: resolveCorrect(i),
          elapsedMs: answerBySeq.get(i.seq)?.elapsedMs ?? 0,
        })),
      );

      let hp = run.hp - bossDmgTotal;
      const bossCleared = bossHp <= 0;
      const extra = { ...((run.extra ?? {}) as Record<string, unknown>) };

      if (bossCleared) {
        extra.everBoss = true;
        extra.lastBossDay = run.day;
        extra.lastBossConsumed = this.consumedCount(run.items);
        extra.bossClearedCount = ((extra.bossClearedCount as number) ?? 0) + 1;
        hp = Math.min(run.maxHp, hp + SURVIVAL.BOSS_HEAL);
        await this.prisma.run.update({
          where: { id: run.id },
          data: { hp, extra: extra as unknown as Prisma.InputJsonValue },
        });
        if (hp <= 0) return this.finishAfterDeath(userId, run, hp);
        return this.nextDay(userId, run, character, correct / Math.max(1, bossItems.length), true);
      }

      await this.prisma.run.update({ where: { id: run.id }, data: { hp } });
      if (hp <= 0) return this.finishAfterDeath(userId, run, hp);
      return this.nextDay(userId, run, character, 1, false);
    }

    // ── 普通波结算：答案驱动重放战场 ──
    const pending = run.items.filter((i) => !i.answered);
    if (pending.length === 0) throw new BadRequestException('本波无待答题');

    const tierOf = new Map<string, string>();
    for (const it of run.items) {
      const w = wordRows.get(it.wordId);
      if (w) tierOf.set(it.wordId, w.tier);
    }
    const isNewByWord = this.newWordSet(run.items);

    const battle = this.replayDay({
      hp: run.hp,
      items: pending,
      resolveCorrect,
      isNewByWord,
      tierOf,
      day: run.day,
      hpLv,
      atkLv,
      defLv,
      buffs,
    });

    let hp = battle.hp;
    // 吸血（每答对 N 题回 1）
    const leech = Math.floor(battle.correct / leechN(buffs.leech));
    hp = Math.min(run.maxHp, hp + leech);

    await this.persistAnswers(
      pending.map((i) => ({
        id: i.id,
        correct: resolveCorrect(i),
        elapsedMs: answerBySeq.get(i.seq)?.elapsedMs ?? 0,
      })),
    );

    if (hp <= 0) return this.finishAfterDeath(userId, run, hp);

    const extra = (run.extra ?? {}) as Record<string, unknown>;
    const acc = battle.correct / Math.max(1, battle.correct + battle.wrong);

    // Boss 双驱动判定
    const boss = shouldTriggerBoss({
      day: run.day,
      lastBossDay: (extra.lastBossDay as number) ?? 0,
      everBoss: (extra.everBoss as boolean) ?? false,
      cumulativeConsumed: this.consumedCount(run.items),
      lastBossConsumed: (extra.lastBossConsumed as number) ?? 0,
    });

    if (boss) {
      // 首领波：战前 +6 HP 小回复
      hp = Math.min(run.maxHp, hp + SURVIVAL.BOSS_HEAL);
      await this.prisma.run.update({ where: { id: run.id }, data: { hp } });
      const bossQuestions = await this.buildBossWave(run.id, run.mode as GameMode, run.day);
      return {
        day: run.day,
        hp,
        maxHp: run.maxHp,
        buffs: run.buffs as string[],
        bossWave: true,
        bossCleared: false,
        ended: false,
        questions: bossQuestions,
        previewWords: [],
        injectedNew: 0,
        nextDayNewWords: 0,
        bossHp: bossHits(run.day, atkLv),
      };
    }

    // 无首领：更新状态并进入次日
    await this.prisma.run.update({ where: { id: run.id }, data: { hp } });
    return this.nextDay(userId, run, character, acc, false);
  }

  // ── 主动收枪 ──
  async finish(
    userId: number,
    runId: number,
    opts: { surrender: boolean },
  ): Promise<RunFinish> {
    const run = await this.prisma.run.findFirst({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException('Run 不存在');
    if (run.status === 'finished') throw new BadRequestException('Run 已结算');
    return this.settle(userId, run, opts.surrender);
  }

  // ── 内部：次日生成 ──
  private async nextDay(
    userId: number,
    run: {
      id: number;
      bankId: number;
      stageId: number;
      mode: string;
      day: number;
      hp: number;
      maxHp: number;
      buffs: Prisma.JsonValue;
      lastInjectDay: number;
    },
    character: { hpLv: number; atkLv: number; defLv: number },
    acc: number,
    bossJustCleared: boolean,
  ): Promise<RunAdvanceResponse> {
    const nextDayNum = run.day + 1;
    if (nextDayNum > SURVIVAL.MAX_DAYS) return this.finishAfterDeath(userId, run, run.hp);

    // 注入判定（轻量 Q + 保底 5，严格隔天，首领波日不注）
    const qLight = await this.prisma.runItem.count({
      where: { runId: run.id, answered: true, correct: false },
    });
    const injectAllowed =
      !bossJustCleared &&
      nextDayNum - run.lastInjectDay >= SURVIVAL.INJECT_COOLDOWN_DAYS &&
      acc >= SURVIVAL.INJECT_ACC_GATE;
    let injected = 0;
    let lastInjectDay = run.lastInjectDay;
    if (injectAllowed) {
      injected = injectAmount(qLight);
      if (injected > 0) lastInjectDay = nextDayNum;
    }

    const pool = await this.stagePool(run.bankId, run.stageId);
    const usedInRun = new Set(
      (await this.prisma.runItem.findMany({ where: { runId: run.id }, select: { wordId: true } })).map((i) => i.wordId),
    );

    // 明日词：注入新词 + 复习/错题补足
    const newPool = pool.filter((w) => !usedInRun.has(w.wordId)).slice(0, injected);
    const reviewNeed = SURVIVAL.QUESTIONS_PER_DAY - newPool.length;
    const reviewPool = this.pickReviews(pool, usedInRun, reviewNeed, run.id);

    const dayWords = [...newPool, ...reviewPool].slice(0, SURVIVAL.QUESTIONS_PER_DAY);
    if (dayWords.length === 0) return this.finishAfterDeath(userId, run, run.hp);

    const created = await this.prisma.$transaction(async (tx) => {
      const maxSeq = await tx.runItem.aggregate({ where: { runId: run.id }, _max: { seq: true } });
      const base = (maxSeq._max.seq ?? -1) + 1;
      await tx.runItem.createMany({
        data: dayWords.map((w, i) => ({
          runId: run.id,
          seq: base + i,
          wordId: w.wordId,
          senseIdx: 0,
          type: newPool.includes(w) ? 'new' : 'review',
        })),
      });
      return tx.run.update({
        where: { id: run.id },
        data: { day: nextDayNum, hp: run.hp, maxHp: run.maxHp, lastInjectDay },
      });
    });

    const questions = await this.buildDayQuestions(
      run.id,
      run.mode as GameMode,
      dayWords,
      newPool.length > 0 ? 'new' : 'review',
      (await this.prisma.runItem.aggregate({ where: { runId: run.id }, _max: { seq: true } }))._max.seq ?? 0,
    );
    return {
      day: nextDayNum,
      hp: created.hp,
      maxHp: created.maxHp,
      buffs: created.buffs as string[],
      bossWave: false,
      bossCleared: false,
      ended: false,
      questions,
      previewWords: newPool.map((w) => toLevelWord(w.word)),
      injectedNew: injected,
      nextDayNewWords: injected,
      buffChoices: this.pickBuffChoices(run.hp, run.maxHp, buffsOf(created.buffs)),
    };
  }

  // ── 内部：首领波组题（本局错词压轴）──
  private async buildBossWave(runId: number, mode: GameMode, day: number): Promise<RunQuestion[]> {
    const wrongItems = await this.prisma.runItem.findMany({
      where: { runId, answered: true, correct: false },
      orderBy: { seq: 'asc' },
      take: 10,
    });
    const wrongIds = [...new Set(wrongItems.map((w) => w.wordId))];
    const wordRows = await this.loadWords(wrongIds);

    const items = wrongIds.map((wid, i) => {
      const w = wordRows.get(wid);
      return {
        seq: 9000 + i,
        wordId: wid,
        senseIdx: 0,
        type: 'boss' as const,
        runId,
      };
    });
    if (items.length > 0) {
      await this.prisma.runItem.createMany({ data: items });
    }

    return items.map((it, i) => {
      const w = wordRows.get(it.wordId);
      const q = buildQuestion({
        seq: it.seq,
        wordId: it.wordId,
        senseIdx: it.senseIdx,
        text: w?.text ?? '',
        promptBase:
          mode === 'dictation'
            ? (w?.phoneticAm ?? w?.phoneticEn ?? '')
            : (w?.senses[0]?.meaning ?? w?.text ?? ''),
        example: w?.senses[0]?.example,
        phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
        tier: (w?.tier ?? 'I') as DifficultyTier,
        mode,
        source: 'boss',
      });
      return { ...q, isNew: false };
    });
  }

  // ── 内部：战场回放（答案驱动，与仿真逐问循环一致）──
  private replayDay(opts: {
    hp: number;
    items: { id: number; seq: number; wordId: string }[];
    resolveCorrect: (item: { wordId: string; seq: number }) => boolean;
    isNewByWord: Set<string>;
    tierOf: Map<string, string>;
    day: number;
    hpLv: number;
    atkLv: number;
    defLv: number;
    buffs: BuffState;
  }): BattleResult {
    const { items, resolveCorrect, isNewByWord, tierOf, day, atkLv, defLv, buffs } = opts;
    const totalMonsters = Math.max(1, Math.ceil(SURVIVAL.QUESTIONS_PER_DAY / SURVIVAL.MONSTERS_DIV));
    const maxField = SURVIVAL.MAX_FIELD;
    const spawnGap = Math.max(1, Math.floor(SURVIVAL.QUESTIONS_PER_DAY / totalMonsters));

    const tierOfQuestion = (i: number): number => {
      const t = tierOf.get(items[i]?.wordId ?? '');
      return t === 'I' ? 0 : t === 'II' ? 1 : t === 'III' ? 2 : t === 'IV' ? 3 : 0;
    };

    const spawn = (i: number) => ({
      hp: monsterHits(tierOfQuestion(i), day, atkLv, buffs.dmg),
      timer: travelBudget(day),
    });

    let hp = opts.hp;
    let correct = 0;
    let wrong = 0;
    let leaked = 0;
    let stuns = 0;
    let consecWrong = 0;
    let stunNext = false;

    const field: { hp: number; timer: number }[] = [spawn(0)];
    let spawnIdx = 1;

    for (let i = 0; i < items.length; i++) {
      if (hp <= 0) break;
      if (i > 0 && i % spawnGap === 0 && field.length < maxField && spawnIdx < totalMonsters) {
        field.push(spawn(i));
        spawnIdx++;
      }
      if (stunNext) {
        stunNext = false;
        stuns++;
        continue;
      }

      const ok = resolveCorrect(items[i]!);
      if (ok) {
        correct++;
        consecWrong = 0;
        if (field.length > 0) {
          const front = field[0]!;
          front.hp -= isNewByWord.has(items[i]!.wordId) ? SURVIVAL.NEW_WORD_DMG_X : 1;
          if (front.hp <= 0) {
            field.shift();
            if (spawnIdx < totalMonsters) {
              field.push(spawn(i));
              spawnIdx++;
            }
          }
        }
      } else {
        wrong++;
        consecWrong++;
        const raw = Math.min(
          SURVIVAL.WRONG_BASE + SURVIVAL.WRONG_GROW * (day - 1),
          SURVIVAL.WRONG_CAP,
        );
        hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : applyDef(raw, defLv);
        if (hp <= 0) break;
      }

      if (consecWrong >= 2) {
        stunNext = true;
        consecWrong = 0;
      }

      // 场上怪逼近（仅前锋漏怪）
      if (stunNext) continue;
      for (const m of field) m.timer -= 1;
      if (field.length > 0 && field[0]!.timer <= 0) {
        leaked++;
        field.shift();
        const raw = Math.min(
          SURVIVAL.LEAK_BASE + SURVIVAL.LEAK_GROW * (day - 1),
          SURVIVAL.LEAK_CAP,
        );
        hp -= buffs.dodge > 0 ? (buffs.dodge--, 0) : applyDef(raw, defLv);
        if (spawnIdx < totalMonsters) {
          field.push(spawn(i));
          spawnIdx++;
        }
      }
      while (field.length < maxField && spawnIdx < totalMonsters) {
        field.push(spawn(i));
        spawnIdx++;
      }
    }

    return { hp: Math.max(0, hp), correct, wrong, leaked, stuns };
  }

  // ── 内部：逐题落库 ──
  private async persistAnswers(rows: { id: number; correct: boolean; elapsedMs: number }[]): Promise<void> {
    for (const r of rows) {
      await this.prisma.runItem.update({
        where: { id: r.id },
        data: { answered: true, correct: r.correct, elapsedMs: r.elapsedMs },
      });
    }
  }

  // ── 内部：死亡结算 ──
  private async finishAfterDeath(
    userId: number,
    run: { id: number; hp: number; maxHp: number; day: number; stageId: number },
    finalHp: number,
  ): Promise<RunAdvanceResponse> {
    const finish = await this.settle(userId, run, false);
    return {
      day: run.day,
      hp: Math.max(0, finalHp),
      maxHp: run.maxHp,
      buffs: [],
      bossWave: false,
      bossCleared: false,
      ended: true,
      result: finish,
      questions: [],
      previewWords: [],
      injectedNew: 0,
      nextDayNewWords: 0,
    };
  }

  // ── 内部：统一结算 ──
  private async settle(
    userId: number,
    run: { id: number; hp: number; day: number; stageId: number },
    surrender: boolean,
  ): Promise<RunFinish> {
    const character = await this.prisma.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');

    // 历史最高（收枪不计破纪录）
    const prevBest = await this.prisma.run.findFirst({
      where: { userId, stageId: run.stageId, status: 'finished' },
      orderBy: { day: 'desc' },
      select: { day: true },
    });
    const bestDays = Math.max(prevBest?.day ?? 0, run.day);
    const recordBroken = !surrender && run.day > (prevBest?.day ?? 0);

    // 正确率来自本局已答题
    const stats = await this.prisma.runItem.aggregate({
      where: { runId: run.id, answered: true },
      _count: true,
    });
    const wrongItems = await this.prisma.runItem.count({
      where: { runId: run.id, answered: true, correct: false },
    });
    const total = stats._count;
    const correct = total - wrongItems;
    const acc = total > 0 ? correct / total : 0;

    const rating = computeRating({
      total: Math.max(1, total),
      correct,
      avgElapsedMs: 8000,
      perfectBonus: acc === 1,
    });
    const xp = ratingExp(rating) + SURVIVAL.XP_DAY_BASE * Math.min(run.day, SURVIVAL.XP_DAY_CAP);
    let coins = correct * SURVIVAL.COINS_PER_CORRECT;
    const extra = (await this.prisma.run.findUnique({
      where: { id: run.id },
      select: { extra: true },
    }))?.extra as Record<string, unknown> | undefined;
    const bossClearedCount = ((extra?.bossClearedCount as number) ?? 0) + ((extra?.everBoss as boolean) ? 1 : 0);
    coins += bossClearedCount * SURVIVAL.COINS_PER_BOSS;
    if (surrender) coins = Math.round(coins * SURVIVAL.SURRENDER_RATE);

    const matTier = materialTierAt(run.day);
    const drops = rollDrops(rating).filter((d) => d.tier <= matTier);
    if (drops.length === 0 && matTier >= 1) {
      drops.push({ materialCode: 'essence_1', tier: 1, count: 1 });
    }

    const materialRows = await this.prisma.material.findMany({
      where: { code: { in: drops.map((d) => d.materialCode) } },
    });
    const matIdByCode = new Map(materialRows.map((m) => [m.code, m.id]));

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.run.updateMany({
        where: { id: run.id, status: 'active' },
        data: {
          status: 'finished',
          hp: Math.max(0, run.hp),
          surrendered: surrender,
          recordBroken,
        },
      });
      if (updated.count === 0) throw new BadRequestException('Run 已结算');

      await tx.userCharacter.update({
        where: { userId },
        data: { exp: { increment: xp } },
      });
      await tx.user.update({ where: { id: userId }, data: { coins: { increment: coins } } });

      for (const d of drops) {
        const mid = matIdByCode.get(d.materialCode);
        if (!mid) continue;
        await tx.userMaterial.upsert({
          where: { userId_materialId: { userId, materialId: mid } },
          update: { count: { increment: d.count } },
          create: { userId, materialId: mid, count: d.count },
        });
      }

      // SRS：本局词级进度
      const items = await tx.runItem.findMany({ where: { runId: run.id } });
      const wordIds = [...new Set(items.map((i) => i.wordId))];
      const progress = await tx.userWordProgress.findMany({ where: { userId, wordId: { in: wordIds } } });
      const now = Date.now();
      for (const item of items) {
        const p = progress.find((x) => x.wordId === item.wordId);
        const srs = srsSchedule(
          p ? { reviewStage: p.reviewStage, ease: p.ease } : null,
          item.correct ?? true,
        );
        const next = srs.reviewStage > 0 ? new Date(now + intervalDays(srs.reviewStage) * 86400000) : null;
        await tx.userWordProgress.upsert({
          where: { userId_wordId: { userId, wordId: item.wordId } },
          create: {
            userId,
            wordId: item.wordId,
            mastery: Math.min(100, (item.correct ? 20 : 5) + (p?.mastery ?? 0)),
            reviewStage: srs.reviewStage,
            nextReviewAt: next,
            ease: srs.ease,
            correctCount: item.correct ? 1 : 0,
            wrongCount: item.correct ? 0 : 1,
            inWrongBook: !item.correct,
            firstEncounteredAt: new Date(now),
            lastEncounteredAt: new Date(now),
          },
          update: {
            mastery: Math.min(100, (item.correct ? 20 : 5) + (p?.mastery ?? 0)),
            reviewStage: srs.reviewStage,
            nextReviewAt: next,
            ease: srs.ease,
            correctCount: { increment: item.correct ? 1 : 0 },
            wrongCount: { increment: item.correct ? 0 : 1 },
            inWrongBook: item.correct ? (p?.inWrongBook ?? false) : true,
            lastEncounteredAt: new Date(now),
          },
        });
      }
    });

    return {
      runId: run.id,
      daysSurvived: run.day,
      bossClearedCount,
      bestDays,
      recordBroken,
      surrendered: surrender,
      xp,
      coins,
      materials: drops.map((d) => ({ materialCode: d.materialCode, tier: d.tier, count: d.count })),
      rating,
    };
  }

  // ── 内部：词池 ──
  private async stagePool(bankId: number, stageId: number) {
    const rows = await this.prisma.bankWord.findMany({
      where: { bankId, stage: stageId },
      orderBy: [{ word: { difficultyScore: 'asc' } }, { wordId: 'asc' }],
      include: {
        word: {
          include: { senses: { orderBy: { idx: 'asc' } } },
        },
      },
    });
    return rows as unknown as { wordId: string; word: WordRow }[];
  }

  // ── 内部：本局新词集合（type=new 即新词）──
  private newWordSet(items: { type: string; wordId: string }[]): Set<string> {
    return new Set(items.filter((i) => i.type === 'new').map((i) => i.wordId));
  }

  // ── 内部：累计新词消耗 ──
  private consumedCount(items: { type: string; wordId: string }[]): number {
    return items.filter((i) => i.type === 'new').length;
  }

  // ── 内部：复习/错题优先选词 ──
  private pickReviews(
    pool: { wordId: string; word: WordRow }[],
    used: Set<string>,
    need: number,
    _runId: number,
  ): { wordId: string; word: WordRow }[] {
    if (need <= 0) return [];
    // 错词优先（本局答错的再考），其次已学未二次复测
    return pool.filter((w) => used.has(w.wordId)).slice(0, need);
  }

  // ── 内部：组题（seq 从 startSeq 递增）──
  private async buildDayQuestions(
    runId: number,
    mode: GameMode,
    words: { wordId: string; word: WordRow }[],
    source: 'new' | 'review',
    startSeq: number,
  ): Promise<RunQuestion[]> {
    const wordRows = await this.loadWords(words.map((w) => w.wordId));
    return words.map((pw, i) => {
      const w = wordRows.get(pw.wordId);
      const q = buildQuestion({
        seq: startSeq + i,
        wordId: pw.wordId,
        senseIdx: 0,
        text: w?.text ?? '',
        promptBase:
          mode === 'dictation'
            ? (w?.phoneticAm ?? w?.phoneticEn ?? '')
            : (w?.senses[0]?.meaning ?? w?.text ?? ''),
        example: w?.senses[0]?.example,
        phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
        tier: (w?.tier ?? 'I') as DifficultyTier,
        mode,
        source,
      });
      return { ...q, isNew: source === 'new' };
    });
  }

  // ── 内部：加载单词 ──
  private async loadWords(wordIds: string[]): Promise<Map<string, WordRow>> {
    if (wordIds.length === 0) return new Map();
    const rows = await this.prisma.word.findMany({
      where: { id: { in: [...new Set(wordIds)] } },
      include: { senses: { orderBy: { idx: 'asc' } } },
    });
    return new Map(rows.map((w) => [w.id, w]));
  }

  // ── 内部：关闭旧 active Run（收枪语义）──
  private async closeActive(userId: number): Promise<void> {
    const active = await this.prisma.run.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) return;
    await this.settle(userId, active, true);
  }

  // ── 内部：普通 buff 三选一（血量低时倾向防御）──
  private pickBuffChoices(hp: number, maxHp: number, buffs: BuffState): string[] {
    const lowHp = maxHp > 0 && hp / maxHp < 0.35;
    if (lowHp) return ['maxhp', 'leech', 'dodge'];
    const pool: string[] = [...NORMAL_BUFFS];
    // 已满的 buff 不再给出
    const available = pool.filter((b) => {
      if (b === 'maxhp') return buffs.maxHp < SURVIVAL.BUFF_MAXHP_MAX;
      if (b === 'leech') return buffs.leech < SURVIVAL.BUFF_LEECH_MAX;
      if (b === 'dmg') return buffs.dmg < SURVIVAL.BUFF_DMG_MAX;
      if (b === 'dodge') return buffs.dodge < SURVIVAL.BUFF_DODGE_MAX;
      if (b === 'freeze') return buffs.freeze < SURVIVAL.BUFF_FREEZE_MAX;
      return true;
    });
    // 洗牌取 3
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = available[i]!;
      available[i] = available[j]!;
      available[j] = tmp;
    }
    return available.slice(0, 3);
  }
}

// ── 工具 ──
function toRunInfo(run: {
  id: number;
  bankId: number;
  stageId: number;
  mode: string;
  day: number;
  hp: number;
  maxHp: number;
  buffs: Prisma.JsonValue;
  status: string;
  surrendered: boolean;
  createdAt: Date;
}): RunInfo {
  return {
    id: run.id,
    bankId: run.bankId,
    stageId: run.stageId,
    mode: run.mode as GameMode,
    day: run.day,
    hp: run.hp,
    maxHp: run.maxHp,
    buffs: Array.isArray(run.buffs) ? (run.buffs as string[]) : [],
    status: run.status as 'active',
    surrendered: run.surrendered,
    createdAt: run.createdAt.toISOString(),
  };
}

function toLevelWord(w: WordRow): LevelWord {
  return {
    wordId: w.id,
    text: w.text,
    phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
    tier: w.tier,
    status: 'new',
    meanings: w.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
  };
}

function parseBuffs(raw: Prisma.JsonValue): BuffState {
  const arr = Array.isArray(raw) ? (raw as string[]) : [];
  return {
    maxHp: arr.filter((b) => b === 'maxhp').length,
    leech: arr.filter((b) => b === 'leech').length,
    dmg: arr.filter((b) => b === 'dmg').length,
    dodge: arr.filter((b) => b === 'dodge').length,
    freeze: arr.filter((b) => b === 'freeze').length,
  };
}

function buffsOf(raw: Prisma.JsonValue): BuffState {
  return parseBuffs(raw);
}

// 应用 buff 选择（普通 buff / 传说技能），返回是否生效
function applyBuffChoice(run: { buffs: Prisma.JsonValue; maxHp: number }, state: BuffState, choice: string): boolean {
  const arr = Array.isArray(run.buffs) ? (run.buffs as string[]) : [];
  if (choice === 'maxhp' && state.maxHp < SURVIVAL.BUFF_MAXHP_MAX) {
    arr.push('maxhp');
    run.maxHp += SURVIVAL.BUFF_MAXHP;
    run.buffs = arr;
    return true;
  }
  if (choice === 'dmg' && state.dmg < SURVIVAL.BUFF_DMG_MAX) {
    arr.push('dmg');
    run.buffs = arr;
    return true;
  }
  if (choice === 'leech' && state.leech < SURVIVAL.BUFF_LEECH_MAX) {
    arr.push('leech');
    run.buffs = arr;
    return true;
  }
  if (choice === 'dodge' && state.dodge < SURVIVAL.BUFF_DODGE_MAX) {
    arr.push('dodge');
    run.buffs = arr;
    return true;
  }
  if (choice === 'freeze' && state.freeze < SURVIVAL.BUFF_FREEZE_MAX) {
    arr.push('freeze');
    run.buffs = arr;
    return true;
  }
  if ((LEGEND_BUFFS as readonly string[]).includes(choice)) {
    arr.push(choice);
    run.buffs = arr;
    return true;
  }
  return false;
}