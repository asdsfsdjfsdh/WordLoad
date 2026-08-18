// 生存 Run 服务：创建 / 续 Run / 波末推进 / 结算
// 核心原则：服务端权威 — typed 比对判定、波内血量/Boss 击破由共享引擎按题重放，客户端仅传答案
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActiveRunResponse,
  BackupWordsResult,
  ConsolidationHint,
  CreateRunResponse,
  DifficultyTier,
  FoilOption,
  GameMode,
  LevelWord,
  PoolExpandInfo,
  ReplenishResult,
  RerollRunResponse,
  RunAdvanceResponse,
  RunFinish,
  RunInfo,
  RunKind,
  RunQuestion,
  RunWordStats,
  TierIdx,
} from '@word-journey/shared';
import {
  BUFF_DEFS,
  REROLL_COIN_COST,
  SURVIVAL,
  UNIT_BOSS,
  bossHits,
  createWaveSim,
  resolveEffects,
} from '@word-journey/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocSessionMix, buildQuestion, hintLevelFor, pickWeighted, rotateSense, type HintLevel } from '../questions/question-builder';
import { shouldTriggerBoss } from './boss-trigger';
import { pickBossWords } from './boss-selection';
import { shouldInject } from './inject';
import { emptyMemory, memoryOf, pickReviewWords, type ReviewCandidate, type RunWordMemory } from './forgetting';
import { cleanRateOf, computePoolStages, questionsPerDayFor, shouldExpand } from './pool-expand';
import { pickBuffs, pickLegends } from './buff-picker';
import { computeRewards, isRecordBroken } from './rewards';
import { finalBossHp } from './unit-boss';
import { isFirstClear, isPreKnown, needsRetest, pickNewWords, unitProgressOf as unitProgressOfFn, weakTierOf, type UnitWordState } from './unit-clear';
import {
  MASTER_STAGE,
  appendStageHistory,
  applyWrongbookState,
  computeRating,
  intervalDays,
  isAnswerCorrect,
  levelFromExp,
  masteryFromStage,
  rollDrops,
  srsSchedule,
  type WrongbookState,
} from '../sessions/settlement';

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
  mnemonic: string | null;
  senses: { idx: number; meaning: string; example: string }[];
  confusableA: { wordB: { text: string }; type: string }[];
  confusableB: { wordA: { text: string }; type: string }[];
}

// 该词的易混对比词（形近/音近），仅用于答错巩固阶段展示，不参与正常出题/排序
function confusableOf(w: WordRow): ConsolidationHint | undefined {
  const a = w.confusableA[0];
  if (a) return { counterpart: a.wordB.text, note: a.type === 'homophone' ? '音近' : '形近' };
  const b = w.confusableB[0];
  if (b) return { counterpart: b.wordA.text, note: b.type === 'homophone' ? '音近' : '形近' };
  return undefined;
}

// 选中文模式干扰项候选池：从阶段词池抽样 ≤40 个 {text, meaning}（去重），保证每题 ≥3 干扰项
function buildFoilPool(pool: { wordId: string; word: WordRow }[]): FoilOption[] {
  const seen = new Set<string>();
  const out: FoilOption[] = [];
  for (const w of [...pool].sort(() => Math.random() - 0.5)) {
    const meaning = w.word.senses[0]?.meaning ?? '';
    if (!w.word.text || !meaning) continue;
    const key = `${w.word.text}::${meaning}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: w.word.text,
      meaning,
      meanings: w.word.senses.length > 0 ? w.word.senses.map((s) => s.meaning) : undefined,
    });
    if (out.length >= 40) break;
  }
  return out;
}

@Injectable()
export class RunsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 创建 Run ──
  async create(
    userId: number,
    opts: { bankCode: string; stageId: number; mode: GameMode; kind?: RunKind },
  ): Promise<CreateRunResponse> {
    const kind = opts.kind ?? 'unit';
    const bank = await this.prisma.wordBank.findUnique({ where: { code: opts.bankCode } });
    if (!bank) throw new NotFoundException(`词书不存在: ${opts.bankCode}`);

    // 每 kind 仅一个 active Run：已有 → 自动收枪结算旧 Run
    await this.closeActive(userId, kind);

    const character = await this.prisma.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');
    const hpLv = character.hpLv;
    const maxHp = SURVIVAL.MAX_HP_BASE + SURVIVAL.HP_PER_LV * hpLv;

    const isUnit = kind === 'unit';
    // unit：恒为该 Unit 单 stage（词在 Unit 内循环）；survival：红宝书初始并池起始 Unit
    const hierarchicalStart = opts.stageId >= 100;
    const startStages = isUnit
      ? [opts.stageId]
      : hierarchicalStart
        ? computePoolStages(await this.bankStageIds(bank.id), opts.stageId, 1)
        : [opts.stageId];
    const pool = await this.stagePoolMany(bank.id, startStages);
    if (pool.length === 0) throw new BadRequestException('阶段无词可战');

    // unit：重开继承后开局已全部掌握 → Day1 直接 Final Boss（决战复赛，词池不足仍可击破）
    if (isUnit && (await this.unitProgress(userId, bank.id, opts.stageId)).doneAll) {
      const finalHp = finalBossHp();
      const run = await this.prisma.run.create({
        data: {
          userId,
          bankId: bank.id,
          stageId: opts.stageId,
          mode: opts.mode,
          kind: 'unit',
          hp: maxHp,
          maxHp,
          buffs: [],
          lastInjectDay: 1,
          status: 'active',
          finalBossHp: finalHp,
        },
      });
      const bossQuestions = await this.buildBossWave(run.id, userId, opts.mode, 1, character.atkLv, undefined, finalHp);
      const meta = await this.unitMeta(userId, run);
      return {
        run: toRunInfo(run),
        kind: 'unit',
        cleared: false,
        ...meta,
        bossWave: true,
        bossHp: finalHp,
        day: 1,
        hp: maxHp,
        maxHp,
        combo: 0,
        questions: bossQuestions,
        previewWords: [],
        injectedNew: 0,
        poolUsed: pool.length,
        foilPool: opts.mode === 'choice' ? buildFoilPool(pool) : undefined,
        atkLv: character.atkLv,
        defLv: character.defLv,
        executeSpec: character.executeSpec,
        vampireSpec: character.vampireSpec,
        coins: await this.coinsOf(this.prisma, userId),
        rerolledToday: false,
      };
    }

    // 首日：与普通模式一致按 7:2:1 混合（新词/复习/错题本），缺额新词补足
    // unit 时 mixFirstDay 以 Unit 词量为准（≤20 全量出战）
    const dayWords = await this.mixFirstDay(userId, pool);
    const injectedNew = dayWords.filter((w) => w.source === 'new').length;
    if (dayWords.length === 0) throw new BadRequestException('阶段无词可战');

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.run.create({
        data: {
          userId,
          bankId: bank.id,
          stageId: opts.stageId,
          mode: opts.mode,
          kind,
          hp: maxHp,
          maxHp,
          buffs: [],
          lastInjectDay: 1,
          status: 'active',
          extra: !isUnit && hierarchicalStart
            ? ({ [POOLED_UNITS_KEY]: 1 } as Prisma.InputJsonValue)
            : undefined,
        },
      });
      // 义项轮换：首日同普通模式，按用户义项级进度取各词义项
      const senseByWord = await this.senseIdxOf(userId, dayWords, tx);
      await tx.runItem.createMany({
        data: dayWords.map((w, seq) => ({
          runId: created.id,
          seq,
          wordId: w.wordId,
          senseIdx: senseByWord.get(w.wordId) ?? 0,
          type: w.source,
        })),
      });
      return created;
    });

    const levels = await this.hintLevels(userId, dayWords.map((w) => w.wordId));
    const senseByWord = await this.senseIdxOf(userId, dayWords);
    const questions = await this.buildDayQuestions(run.id, run.mode as GameMode, dayWords, 0, undefined, levels, senseByWord);
    const poolExpand = !isUnit && hierarchicalStart
      ? await this.poolExpandInfo(userId, run)
      : undefined;
    const meta = await this.unitMeta(userId, run);
    return {
      run: toRunInfo(run),
      kind,
      cleared: run.cleared,
      ...meta,
      day: 1,
      hp: maxHp,
      maxHp,
      combo: 0,
      questions,
      previewWords: dayWords.map((w) => toLevelWord(w.word, w.source as LevelWord['status'])),
      injectedNew,
      poolExpand,
      poolUsed: new Set(dayWords.map((w) => w.wordId)).size,
      foilPool: opts.mode === 'choice' ? buildFoilPool(pool) : undefined,
      atkLv: character.atkLv,
      defLv: character.defLv,
      executeSpec: character.executeSpec,
      vampireSpec: character.vampireSpec,
      coins: await this.coinsOf(this.prisma, userId),
      rerolledToday: false,
    };
  }
  async replenish(userId: number, runId: number, opts?: { wordId?: string }): Promise<ReplenishResult | null> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId, status: 'active' },
      select: { id: true, bankId: true, stageId: true, mode: true, userId: true, kind: true, extra: true },
    });
    if (!run) throw new NotFoundException('Run 不存在或已结束');

    const { stages: runStages } = await this.runPoolStages(run);
    const pool = await this.stagePoolMany(run.bankId, runStages);
    // 已掌握（斩过）的词不再补入
    const mastered = new Set(
      (await this.prisma.userWordProgress.findMany({
        where: { userId, mastery: { gte: 100 } },
        select: { wordId: true },
      })).map((m) => m.wordId),
    );

    // 并发安全：锁 run 行串行化并发补词，事务内重查已用词，
    // 避免两个并发请求读到同一快照重复选词（runItem 允许同词合法重复，不能靠唯一约束）
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM `Run` WHERE id = ? FOR UPDATE', runId);
      const used = new Set(
        (await tx.runItem.findMany({ where: { runId }, select: { wordId: true } })).map((i) => i.wordId),
      );
      const usedSet = new Set([...used, ...mastered]);

      let pick = null as { wordId: string; word: WordRow } | null;
      if (opts?.wordId) {
        // 前台预取候补词后指定补入该词（闪卡阶段先上替补）：仍须通过未用/未掌握校验
        const target = pool.find((w) => w.wordId === opts.wordId);
        if (target && !usedSet.has(target.wordId)) pick = target;
      }
      if (!pick) {
        const candidates = pool.filter((w) => !usedSet.has(w.wordId));
        pick = candidates.length > 0
          ? candidates[Math.floor(Math.random() * candidates.length)]!
          : null;
      }
      // 池尽时：加权循环抽词（本局错优先），标记 review（不算新词）
      const recycled = !pick ? await this.pickRecycled(userId, pool, 1, new Set(), runId, tx) : [];
      const chosen = pick ?? recycled[0] ?? null;
      if (!chosen) return null;

      const isNew = !!pick; // 仅真正未用词标 new；循环词标 review
      const maxSeq = await tx.runItem.aggregate({ where: { runId }, _max: { seq: true } });
      const seq = (maxSeq._max.seq ?? -1) + 1;
      const senseIdx = (await this.senseIdxOf(userId, [{ wordId: chosen.wordId, word: chosen.word }], tx))
        .get(chosen.wordId) ?? 0;
      await tx.runItem.create({
        data: { runId, seq, wordId: chosen.wordId, senseIdx, type: isNew ? 'new' : 'review' },
      });
      return { wordId: chosen.wordId, word: chosen.word, seq, isNew, senseIdx };
    });
    if (!created) return null;

    const w = (await this.loadWords([created.wordId])).get(created.wordId);
    const levels = await this.hintLevels(run.userId, [created.wordId]);
    const q = buildQuestion({
      seq: created.seq,
      wordId: created.wordId,
      senseIdx: created.senseIdx,
      text: w?.text ?? '',
      promptBase:
        run.mode === 'dictation'
          ? (w?.phoneticAm ?? w?.phoneticEn ?? '')
          : (w?.senses[created.senseIdx]?.meaning ?? w?.senses[0]?.meaning ?? w?.text ?? ''),
      example: w?.senses[created.senseIdx]?.example,
      phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
      tier: (w?.tier ?? 'I') as DifficultyTier,
      mode: run.mode as GameMode,
      source: created.isNew ? 'new' : 'review',
      hintLevel: created.isNew ? 0 : (levels.get(created.wordId) ?? 0),
      confusable: w ? confusableOf(w) : undefined,
      mnemonic: w?.mnemonic ?? undefined,
    });
    return {
      question: { ...q, isNew: created.isNew },
      word: toLevelWord(created.word, created.isNew ? 'new' : 'review'),
      poolUsed: await this.runPoolUsed(run.id),
    };
  }

  // 预习页候补词池批量预取：返回一批未用/未掌握的新词候选（仅供闪卡展示，不落库）。
  // 用户斩词时前端先从本地候补池取词「先上替补」，再调 replenish(wordId) 落库该词。
  async backupWords(
    userId: number,
    runId: number,
    opts: { count?: number; exclude?: string[] } = {},
  ): Promise<BackupWordsResult> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId, status: 'active' },
      select: { id: true, bankId: true, stageId: true, kind: true, extra: true },
    });
    if (!run) throw new NotFoundException('Run 不存在或已结束');

    const { stages: runStages } = await this.runPoolStages(run);
    const pool = await this.stagePoolMany(run.bankId, runStages);
    const used = new Set(
      (await this.prisma.runItem.findMany({ where: { runId }, select: { wordId: true } })).map((i) => i.wordId),
    );
    const mastered = new Set(
      (await this.prisma.userWordProgress.findMany({
        where: { userId, mastery: { gte: 100 } },
        select: { wordId: true },
      })).map((m) => m.wordId),
    );
    const excluded = new Set(opts.exclude ?? []);
    const candidates = pool.filter(
      (w) => !used.has(w.wordId) && !mastered.has(w.wordId) && !excluded.has(w.wordId),
    );
    // 均匀取 count 个（洗牌），避免每次取到同一前缀
    const count = Math.max(1, Math.min(opts.count ?? 6, 20));
    const picked: { wordId: string; word: WordRow }[] = [];
    const indices = candidates.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j]!, indices[i]!];
    }
    for (const i of indices.slice(0, count)) {
      const c = candidates[i];
      if (c) picked.push(c);
    }
    return {
      words: picked.map((p) => toLevelWord(p.word, 'new')),
      poolUsed: await this.runPoolUsed(run.id),
    };
  }

  // ── 金币重抽增益（每波 1 次）──
  async reroll(userId: number, runId: number): Promise<RerollRunResponse> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM `Run` WHERE id = ? FOR UPDATE', runId);
      const run = await tx.run.findFirst({ where: { id: runId, userId, status: 'active' } });
      if (!run) throw new NotFoundException('Run 不存在或已结束');
      const pick = readPendingPick(run.extra);
      if (pick.buffs.length === 0 && pick.legends.length === 0) {
        throw new BadRequestException('当前无待选增益可重抽');
      }
      if (pick.rerolledDay === run.day) throw new BadRequestException('本波增益已重抽过');

      const spent = await tx.user.updateMany({
        where: { id: userId, coins: { gte: REROLL_COIN_COST } },
        data: { coins: { decrement: REROLL_COIN_COST } },
      });
      if (spent.count === 0) throw new BadRequestException('金币不足');

      const codes = Array.isArray(run.buffs) ? (run.buffs as string[]) : [];
      // 与 nextDay 同口径重生成候选（首领前对策由 pickBuffs 内部按 day/hp/acc 收窄）
      const buffChoices = pickBuffs({
        hp: run.hp,
        maxHp: run.maxHp,
        codes,
        day: run.day,
      });
      const legendChoices = pick.legends.length > 0 ? pickLegends(codes) : undefined;
      const nextPick = writePendingPick(run.extra, {
        buffs: buffChoices,
        legends: legendChoices ?? [],
        rerolledDay: run.day,
      });
      await tx.run.update({
        where: { id: runId },
        data: { extra: nextPick as Prisma.InputJsonValue },
      });
      const coins =
        (await tx.user.findUnique({ where: { id: userId }, select: { coins: true } }))?.coins ?? 0;
      return { buffChoices, legendChoices, coins, rerolledToday: true };
    });
  }

  // ── 续 Run ──
  async getActive(userId: number, kind: RunKind = 'unit'): Promise<ActiveRunResponse | null> {
    const run = await this.prisma.run.findFirst({
      where: { userId, kind, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;

    const pending = await this.prisma.runItem.findMany({
      where: { runId: run.id, answered: false },
      orderBy: { seq: 'asc' },
    });
    if (pending.length === 0) {
      // 当前波已答完但未 advance：直接推进（空波，视作全对）
      const adv = await this.advance(userId, run.id, { answers: [] });
      if (adv.ended) return null; // 推进后死亡/结算，无活跃 Run 可续
      return {
        run: {
          ...toRunInfo(run),
          day: adv.day,
          hp: adv.hp,
          maxHp: adv.maxHp,
          buffs: adv.buffs,
        },
        kind: 'unit',
        cleared: adv.cleared ?? run.cleared,
        masteredCount: adv.masteredCount,
        totalCount: adv.totalCount,
        finalBossHp: adv.finalBossHp,
        questions: adv.questions,
        previewWords: adv.previewWords,
        injectedNew: adv.injectedNew,
        poolExpand: adv.poolExpand,
        combo: adv.combo,
        poolUsed: adv.poolUsed,
        foilPool: adv.foilPool,
        bossWave: adv.bossWave,
        bossHp: adv.bossHp,
        buffChoices: adv.buffChoices,
        legendChoices: adv.legendChoices,
        ended: false,
        atkLv: adv.atkLv,
        defLv: adv.defLv,
        executeSpec: adv.executeSpec,
        vampireSpec: adv.vampireSpec,
        recentAcc: adv.recentAcc,
        coins: adv.coins,
        rerolledToday: adv.rerolledToday,
      };
    }

    const wordRows = await this.loadWords(pending.map((i) => i.wordId));
    const isBossWave = pending.every((i) => i.type === 'boss');
    const character = await this.prisma.userCharacter.findUnique({ where: { userId } });
    const levels = await this.hintLevels(userId, pending.map((i) => i.wordId));
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
        source: it.type === 'boss' ? 'boss' : it.type === 'new' ? 'new' : it.type === 'wrongbook' ? 'wrongbook' : 'review',
        hintLevel: it.type === 'new' ? 0 : (levels.get(it.wordId) ?? 0),
        confusable: w ? confusableOf(w) : undefined,
        mnemonic: w?.mnemonic ?? undefined,
      });
      return { ...q, isNew: it.type === 'new' };
    });

    // 续 Run 恢复 buff/传说候选（次日持久化于 extra；首领波前已清除）
    const pendingPick = readPendingPick(run.extra);
    const { stages: runStages } = await this.runPoolStages(run);
    const meta = await this.unitMeta(userId, run);
    return {
      run: toRunInfo(run),
      kind: (run.kind ?? 'unit') as RunKind,
      cleared: run.cleared,
      ...meta,
      questions,
      previewWords: [],
      injectedNew: 0,
      poolExpand: await this.poolExpandInfo(userId, run),
      combo: readCombo(run.extra),
      poolUsed: await this.runPoolUsed(run.id),
      foilPool:
        run.mode === 'choice'
          ? buildFoilPool(await this.stagePoolMany(run.bankId, runStages))
          : undefined,
      bossWave: isBossWave,
      // 首领波血量 = 本波实际题数（pending 即剩余血量：buildBossWave 按剩余血量补题）。
      // 不能用 run.finalBossHp——补题波重连时会把 Boss 血回满（与 advance 重放口径一致，见下方注释）
      bossHp: isBossWave ? pending.length : undefined,
      buffChoices: pendingPick.buffs.length > 0 ? pendingPick.buffs : undefined,
      legendChoices: pendingPick.legends.length > 0 ? pendingPick.legends : undefined,
      ended: false,
      atkLv: character?.atkLv ?? 1,
      defLv: character?.defLv ?? 1,
      executeSpec: character?.executeSpec ?? false,
      vampireSpec: character?.vampireSpec ?? false,
      recentAcc: await this.recentAccOf(run.id),
      coins: await this.coinsOf(this.prisma, userId),
      rerolledToday: readPendingPick(run.extra).rerolledDay === run.day,
    };
  }

  // ── 波末推进 ──
  async advance(
    userId: number,
    runId: number,
    opts: {
      answers: { seq: number; correct: boolean; elapsedMs: number; typed?: string }[];
      buffChoice?: string;
      legendChoice?: string;
      // 幂等守卫：与 run.day 不一致则拒绝，防止重复提交
      expectedDay?: number;
      // 客户端累计游玩时长（秒）：服务端取 max 持久化，结算展示
      playSeconds?: number;
    },
  ): Promise<RunAdvanceResponse> {
    // 行锁 + 事务：并发推进串行化，避免双重推进/重复结算（锁持有至事务提交）
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT id FROM `Run` WHERE id = ? FOR UPDATE', runId);
    const run = await tx.run.findFirst({
      where: { id: runId, userId, status: 'active' },
    });
    if (!run) throw new NotFoundException('Run 不存在或已结束');
    if (opts.expectedDay !== undefined && opts.expectedDay !== run.day) {
      throw new BadRequestException('Run 已推进，请刷新后重试');
    }
    // 游玩时长：客户端秒表上报，服务端取 max 持久化（结算展示；防回退）
    const reportedPlay = opts.playSeconds ?? 0;
    if (reportedPlay > (run.playSeconds ?? 0)) {
      run.playSeconds = reportedPlay;
      await tx.run.update({ where: { id: run.id }, data: { playSeconds: reportedPlay } });
    }

    const character = await tx.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');
    const atkLv = character.atkLv;
    const isUnit = run.kind === 'unit';

    // 应用玩家选择的 buff / 传说技能（仅允许上一波持久化的候选集；非法/过期选择忽略，防注入）
    const pendingPick = readPendingPick(run.extra);
    const appliedB = opts.buffChoice && pendingPick.buffs.includes(opts.buffChoice) ? applyBuffChoice(run, opts.buffChoice) : false;
    const appliedL = opts.legendChoice && pendingPick.legends.includes(opts.legendChoice) ? applyBuffChoice(run, opts.legendChoice) : false;
    if (appliedB || appliedL) {
      await tx.run.update({
        where: { id: run.id },
        data: { buffs: run.buffs as string[], maxHp: run.maxHp },
      });
    }

    // 本波待答题（全部未答 = 本波提交；空 = 续 Run 恢复 / 空波，按全对推进）
    const pending = await tx.runItem.findMany({
      where: { runId: run.id, answered: false },
      orderBy: { seq: 'asc' },
    });
    const total = pending.length;

    let hp: number;
    let bossCleared = false;
    let acc = 1;
    let waveMaxSeq = -1;
    // 局内全局连击：跨波累计（错答归零），由 run.extra.__combo 持久化
    const initialCombo = readCombo(run.extra);
    let combo = initialCombo;
    let maxCombo = run.maxCombo ?? 0;
    // 首领波剩余 Boss 血量（未击破时补题依据；普通波恒 0）
    let bossLeft = 0;
    if (total === 0) {
      // 本波无待答题：可能是"预览全部斩词后未推进"的残局。若存在上次推进之后已落库的答案
      // （skipWord 标记 answered），按真实正确性重放，避免整波怪压力/伤害被跳过。
      const lastAdvSeq = (((run.extra ?? {}) as Record<string, unknown>).lastAdvSeq as number | undefined) ?? -1;
      const answered = await tx.runItem.findMany({
        where: { runId: run.id, answered: true, seq: { gt: lastAdvSeq } },
        orderBy: { seq: 'asc' },
      });
      if (answered.length > 0) {
        const wordRows = await this.loadWords([...new Set(answered.map((i) => i.wordId))], tx);
        const buffArr = Array.isArray(run.buffs) ? (run.buffs as string[]) : [];
        const sim = createWaveSim({
          day: run.day,
          atkLv,
          defLv: character.defLv,
          maxHp: run.maxHp,
          startHp: run.hp,
          buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
          legend: { bossImmunity: false, killHeal: false, bossX2: false, noLeakDmg: false },
          effects: resolveEffects(buffArr),
          specs: { executeSpec: character.executeSpec, vampireSpec: character.vampireSpec },
          questions: answered.map((it) => ({
            tier: tierToIdx(wordRows.get(it.wordId)?.tier),
            isNew: it.type === 'new',
            isBoss: it.type === 'boss',
            len: wordRows.get(it.wordId)?.text.length ?? 4,
          })),
          bossWave: answered.every((i) => i.type === 'boss'),
          bossHp: answered.every((i) => i.type === 'boss') ? answered.length : undefined,
          initialCombo,
        });
        for (const it of answered) sim.step(it.correct === true);
        hp = Math.max(0, sim.hp);
        bossCleared = sim.bossCleared;
        bossLeft = sim.bossHpLeft;
        combo = sim.combo;
        maxCombo = Math.max(maxCombo, sim.maxCombo);
        acc = 1;
        waveMaxSeq = answered[answered.length - 1]!.seq;
      } else {
        hp = run.hp; // 确实无波：无伤害，直接推进
      }
    } else {
      const wordRows = await this.loadWords([...new Set(pending.map((i) => i.wordId))], tx);
      const answerBySeq = new Map(opts.answers.map((a) => [a.seq, a]));
      const resolveCorrect = (item: { wordId: string; seq: number }): boolean => {
        const a = answerBySeq.get(item.seq);
        const typed = a?.typed;
        return isAnswerCorrect(typed, wordRows.get(item.wordId)?.text ?? '');
      };

      // 落库每题对错（SRS/奖励用；typed 以服务端比对为准）
      await this.persistAnswers(
        pending.map((i) => ({
          id: i.id,
          correct: resolveCorrect(i),
          elapsedMs: answerBySeq.get(i.seq)?.elapsedMs ?? 0,
        })),
        tx,
      );

      // 每波增量提交 SRS：词级+义项级排程、错题本状态（连续答对摘标）、进本短间隔
      await this.commitWaveSrs(
        userId,
        run.id,
        pending.map((i) => ({
          wordId: i.wordId,
          senseIdx: i.senseIdx,
          type: i.type,
          correct: resolveCorrect(i),
        })),
        tx,
        run.mode === 'dictation',
      );

      const isBossWave = pending.every((i) => i.type === 'boss');
      const buffArr = Array.isArray(run.buffs) ? (run.buffs as string[]) : [];
      // 服务端权威重放：血量 / 漏怪 / Boss 击破全由共享引擎按题重放决定（buff 效果层解析）
      const sim = createWaveSim({
        day: run.day,
        atkLv: character.atkLv,
        defLv: character.defLv,
        maxHp: run.maxHp,
        startHp: run.hp,
        buffs: { dmg: 0, leech: 0, dodge: 0, freeze: 0 },
        legend: {
          bossImmunity: false,
          killHeal: false,
          bossX2: false,
          noLeakDmg: false,
        },
        effects: resolveEffects(buffArr),
        specs: { executeSpec: character.executeSpec, vampireSpec: character.vampireSpec },
        questions: pending.map((it) => ({
          tier: tierToIdx(wordRows.get(it.wordId)?.tier),
          isNew: it.type === 'new',
          isBoss: it.type === 'boss',
          len: wordRows.get(it.wordId)?.text.length ?? 4,
        })),
        bossWave: isBossWave,
        // 首领波血量：每波题数即本波应打血量（buildBossWave 按剩余血量补题；词池不足收敛到实际题数）。
        // 不能以 run.finalBossHp（完整血量）重放——未击破续战时会把 Boss 血回满，导致永远打不死。
        bossHp: isBossWave ? pending.length : undefined,
        initialCombo,
      });
      for (const it of pending) sim.step(resolveCorrect(it));
      hp = Math.max(0, sim.hp);
      bossCleared = sim.bossCleared;
      bossLeft = sim.bossHpLeft;
      combo = sim.combo;
      maxCombo = Math.max(maxCombo, sim.maxCombo);
      const correctCount = pending.filter((i) => resolveCorrect(i)).length;
      acc = correctCount / total;
      waveMaxSeq = pending[pending.length - 1]!.seq;
    }

    // 记录本波推进边界（空波残局重放用；nextDay 会继续合并 extra 保留该标记）
    run.extra = {
      ...((run.extra ?? {}) as Record<string, unknown>),
      lastAdvSeq: waveMaxSeq,
      [COMBO_KEY]: combo,
    } as Prisma.JsonValue;
    // 本局最高连击（全局累计口径）：跨波取峰，结算展示
    run.maxCombo = maxCombo;

    const isBossWave = total > 0 && pending.every((i) => i.type === 'boss');
    if (isBossWave) {
      // 打过 Boss 就记录波日/首刷标记（未击破也记录，避免次日立即重触发）
      run.everBoss = true;
      run.lastBossDay = run.day;
      if (bossCleared) {
        run.lastBossConsumed = await this.consumedNewCount(run.id, tx);
        run.bossClearedCount = (run.bossClearedCount ?? 0) + 1;
      }
    }
    const bossJustCleared = isBossWave && bossCleared;
    // nextDay 用 run.hp 落库，必须先同步为本次最终血量，避免过期覆盖
    run.hp = hp;

    // Boss 状态列（服务端权威，正式列）
    const bossUpdate = isBossWave
      ? {
          everBoss: run.everBoss,
          lastBossDay: run.lastBossDay,
          lastBossConsumed: run.lastBossConsumed,
          bossClearedCount: run.bossClearedCount,
          maxCombo: run.maxCombo,
        }
      : undefined;

    // unit：Final Boss 击破 → Unit 通关（先于死亡判定：Boss 已倒即视为赢）
    if (isUnit && isBossWave && bossCleared) {
      run.cleared = true;
      await tx.run.update({
        where: { id: run.id },
        data: { hp, cleared: true, ...(bossUpdate ?? {}), maxCombo: run.maxCombo, extra: run.extra as Prisma.InputJsonValue },
      });
      return this.finishAfterDeath(userId, run, hp, tx, character.atkLv, character.defLv, true);
    }

    if (hp <= 0) {
      await tx.run.update({
        where: { id: run.id },
        data: { hp, ...(bossUpdate ?? {}), maxCombo: run.maxCombo, extra: run.extra as Prisma.InputJsonValue },
      });
      return this.finishAfterDeath(userId, run, hp, tx, character.atkLv, character.defLv);
    }

    // 首领波未击破且存活：补足剩余 Boss 血量对应题数，必须补上最后一击（不允许直接过关）
    if (isBossWave && !bossCleared && bossLeft > 0) {
      const extra = await this.buildBossWave(run.id, run.userId, run.mode as GameMode, run.day, character.atkLv, tx, bossLeft);
      if (extra.length > 0) {
        // 先落库当前血量/连击（下一波重放以此为起点）
        await tx.run.update({
          where: { id: run.id },
          data: { hp, maxCombo: run.maxCombo, ...(bossUpdate ?? {}), extra: run.extra as Prisma.InputJsonValue },
        });
        return this.bossWaveResponse(run, character, userId, acc, combo, extra, hp, tx);
      }
    }

    // unit：胜利条件 = 该 Unit 全部词已会（预会 或 出场且无未恢复错词）→ 下一天进入 Final Boss（血量随机、仅一次、战前小回复）
    if (isUnit && !isBossWave) {
      const prog = await this.unitProgress(userId, run.bankId, run.stageId, run.id, tx);
      if (prog.doneAll) {
        const finalHp = run.finalBossHp ?? finalBossHp();
        run.finalBossHp = finalHp;
        const hpNow = Math.min(run.maxHp, hp + SURVIVAL.BOSS_HEAL);
        await tx.run.update({
          where: { id: run.id },
          data: {
            hp: hpNow,
            finalBossHp: finalHp,
            ...(bossUpdate ?? {}),
            // 首领波前无候选；清除未决候选，避免 Boss 波续 Run 时误弹选择页
            extra: writePendingPick(run.extra, { buffs: [], legends: [] }),
          },
        });
        const bossQuestions = await this.buildBossWave(run.id, run.userId, run.mode as GameMode, run.day, character.atkLv, tx, finalHp);
        return this.bossWaveResponse(run, character, userId, acc, combo, bossQuestions, hpNow, tx, finalHp);
      }
    }

    // survival：Boss 双驱动判定（unit 无周期 Boss，仅 Final Boss）
    if (!isUnit) {
      // 红宝书肉鸽词池扩展：新词消耗暴增会频繁触发学习量驱动 Boss，
      // 按已并池 Unit 数放大最小冷却（扩展越深冷却越久），使 Boss 频率回归正常
      const pooledUnitsForBoss = this.pooledUnitsOf(run);
      const bossMinGap =
        pooledUnitsForBoss > 1
          ? SURVIVAL.BOSS_MIN_GAP_DAYS + Math.floor((pooledUnitsForBoss - 1) / 2)
          : SURVIVAL.BOSS_MIN_GAP_DAYS;
      const boss = shouldTriggerBoss({
        day: run.day,
        lastBossDay: run.lastBossDay,
        everBoss: run.everBoss,
        cumulativeConsumed: await this.consumedNewCount(run.id, tx),
        lastBossConsumed: run.lastBossConsumed,
      }, bossMinGap);

      if (boss) {
        // 首领波：战前 +6 HP 小回复（唯一治疗；击破后不再额外回血）
        const hpNow = Math.min(run.maxHp, hp + SURVIVAL.BOSS_HEAL);
        await tx.run.update({
          where: { id: run.id },
          data: {
            hp: hpNow,
            ...(bossUpdate ?? {}),
            // 首领波前无候选；清除未决候选，避免 Boss 波续 Run 时误弹选择页
            extra: writePendingPick(run.extra, { buffs: [], legends: [] }),
          },
        });
        const bossQuestions = await this.buildBossWave(run.id, run.userId, run.mode as GameMode, run.day, character.atkLv, tx);
        return this.bossWaveResponse(run, character, userId, acc, combo, bossQuestions, hpNow, tx);
      }
    }

    // 无首领：更新状态并进入次日
    await tx.run.update({
      where: { id: run.id },
      data: { hp, maxCombo: run.maxCombo, ...(bossUpdate ?? {}), extra: run.extra as Prisma.InputJsonValue },
    });
    return this.nextDay(userId, run, character, acc, bossJustCleared, tx);
    });
  }

  // ── 主动收枪 ──
  async finish(
    userId: number,
    runId: number,
    opts: { surrender: boolean; playSeconds?: number },
  ): Promise<RunFinish> {
    // 行锁串行化并发 finish/advance：状态判断与结算在同一事务内，杜绝重复结算
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Run WHERE id = ${runId} FOR UPDATE`;
      const run = await tx.run.findFirst({ where: { id: runId, userId } });
      if (!run) throw new NotFoundException('Run 不存在');
      if (run.status === 'finished') throw new BadRequestException('Run 已结算');
      // 游玩时长：收枪时客户端秒表值，取 max 持久化后参与结算
      const reportedPlay = opts.playSeconds ?? 0;
      if (reportedPlay > (run.playSeconds ?? 0)) {
        run.playSeconds = reportedPlay;
        await tx.run.update({ where: { id: run.id }, data: { playSeconds: reportedPlay } });
      }
      return this.settle(userId, run, opts.surrender, tx);
    });
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
      extra: Prisma.JsonValue;
      lastInjectDay: number;
      playSeconds?: number | null;
    },
    character: { hpLv: number; atkLv: number; defLv: number; executeSpec: boolean; vampireSpec: boolean },
    acc: number,
    bossJustCleared: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<RunAdvanceResponse> {
    const db = tx ?? this.prisma;
    const nextDayNum = run.day + 1;
    // 无 MAX_DAYS 硬停：跑局只由死亡/通关终结（怪物/伤害随天数无上限成长形成对攻墙）
    const isUnit = (run as { kind?: string }).kind === 'unit';

    // unit：每天固定 DAILY_CAP 题，按 错词层 → 新词层 → 复习词层 填充；
    //   错词（本局答错未恢复）第一优先重测 → 新词（本局未出场，按难度升序）→ 复习（已会词按遗忘曲线补位）
    // survival：注入判定（轻量 Q + 保底 5，严格隔天，首领波日不注）+ 跨 Unit 并池扩展
    let injected = 0;
    let lastInjectDay = run.lastInjectDay;
    let fresh: { wordId: string; word: WordRow }[] = [];
    let dayNewWords: { wordId: string; word: WordRow }[] = [];
    let pool: { wordId: string; word: WordRow }[] = [];
    let usedInRun: Set<string> = new Set();
    let questionsPerDay = 0;
    let reviewPool: { wordId: string; word: WordRow }[] = [];
    let curPooledUnits = 1;
    // unit 当日词来源标记（new 之外：wrongbook / review）
    const unitSources = new Map<string, 'new' | 'review' | 'wrongbook'>();

    if (isUnit) {
      questionsPerDay = UNIT_BOSS.DAILY_CAP;
      pool = await this.stagePoolMany(run.bankId, [run.stageId], tx);
      const poolById = new Map(pool.map((w) => [w.wordId, w]));
      const states = await this.unitWordStates(userId, run.bankId, run.stageId, run.id, tx);
      const stateByWord = new Map(states.map((s) => [s.wordId, s]));

      // 局内记忆（错词按"最近错"、复习按遗忘紧迫度排名）
      const runItems = await db.runItem.findMany({
        where: { runId: run.id, answered: true },
        orderBy: { seq: 'asc' },
        select: { wordId: true, seq: true, correct: true },
      });
      const maxSeq = runItems.length > 0 ? runItems[runItems.length - 1]!.seq : -1;
      const itemsByWord = new Map<string, { seq: number; correct: boolean }[]>();
      for (const it of runItems) {
        if (it.correct === null) continue;
        const list = itemsByWord.get(it.wordId) ?? [];
        list.push({ seq: it.seq, correct: it.correct === true });
        itemsByWord.set(it.wordId, list);
      }
      const memOf = (wid: string): RunWordMemory => {
        const items = itemsByWord.get(wid);
        return items ? memoryOf(items) : emptyMemory();
      };

      // 分层：错词（本局未恢复 或 全局错题本）→ 新词（未出场且非预会）→ 复习（已会，仅填空）
      const wrongCands: ReviewCandidate[] = [];
      const newCands: { wordId: string; word: WordRow }[] = [];
      const reviewCands: ReviewCandidate[] = [];
      for (const w of pool) {
        const s = stateByWord.get(w.wordId);
        if (!s || s.skipped) continue;
        // 预会（重开继承）且无需重测 → 直接算完成、不出题
        if (isPreKnown(s) && !needsRetest(s)) continue;
        if (needsRetest(s)) {
          wrongCands.push({ wordId: w.wordId, memory: memOf(w.wordId), preMastery: s.preMastery / 100 });
        } else if (!s.served) {
          newCands.push(w); // pool 已按难度升序 → 由易到难
        } else {
          reviewCands.push({ wordId: w.wordId, memory: memOf(w.wordId), preMastery: s.preMastery / 100 });
        }
      }

      // 错词全量优先（超 20 时按遗忘紧迫度取 20）→ 新词（O3 难度混合 + C4 弱项 tier 提前）→ 复习补位
      const wrongNeed = Math.min(questionsPerDay, wrongCands.length);
      const wrongPicked = pickReviewWords({ candidates: wrongCands, need: wrongNeed, maxSeq, rng: Math.random });
      // O5 弱玩家保护：近期正确率过低 → 收紧新词量（多复习少新词）
      const newBudget = acc < UNIT_BOSS.ACC_LOW ? UNIT_BOSS.NEW_CAP_LOW : questionsPerDay;
      const newNeed = Math.min(questionsPerDay - wrongPicked.length, newCands.length, newBudget);
      const tierOfWord = (wid: string): DifficultyTier | undefined => {
        const t = poolById.get(wid)?.word.tier as DifficultyTier | undefined;
        return t && ['I', 'II', 'III', 'IV'].includes(t) ? t : undefined;
      };
      const weakTier = weakTierOf(states, tierOfWord);
      const newPicked = pickNewWords(
        newCands.map((w) => ({ wordId: w.wordId, tier: tierOfWord(w.wordId) ?? 'I' })),
        newNeed,
        weakTier,
      )
        .map((c) => poolById.get(c.wordId))
        .filter((w): w is { wordId: string; word: WordRow } => !!w);
      const reviewNeed = Math.max(0, questionsPerDay - wrongPicked.length - newPicked.length);
      const reviewPicked = pickReviewWords({ candidates: reviewCands, need: reviewNeed, maxSeq, rng: Math.random });

      for (const c of wrongPicked) {
        const w = poolById.get(c.wordId);
        if (w) {
          reviewPool.push(w);
          unitSources.set(w.wordId, 'wrongbook');
        }
      }
      fresh = newPicked;
      dayNewWords = newPicked;
      for (const c of reviewPicked) {
        const w = poolById.get(c.wordId);
        if (w) {
          reviewPool.push(w);
          unitSources.set(w.wordId, 'review');
        }
      }
      usedInRun = new Set(itemsByWord.keys());
    } else {
      // 注入判定（纯函数：轻量 Q + 保底 5，严格隔天，首领波日不注）
      const qLight = await db.runItem.count({
        where: { runId: run.id, answered: true, correct: false },
      });
      const decision = shouldInject({
        day: nextDayNum,
        lastInjectDay: run.lastInjectDay,
        acc,
        qLight,
        bossJustCleared,
      });
      injected = decision.amount;
      lastInjectDay = decision.inject ? nextDayNum : run.lastInjectDay;

      // 红宝书肉鸽：动态词池（已并池 Unit 集合）+ 动态每日题量（随并池递增）
      const { stages: runStages, pooledUnits } = await this.runPoolStages(run, tx);
      curPooledUnits = pooledUnits;
      questionsPerDay = questionsPerDayFor(curPooledUnits);
      pool = await this.stagePoolMany(run.bankId, runStages, tx);
      usedInRun = new Set(
        (await db.runItem.findMany({ where: { runId: run.id }, select: { wordId: true } })).map((i) => i.wordId),
      );

      // 明日词：注入新词（type=new）+ 池尽时按权重循环抽词（type=review，本局错优先）+ 复习/错题补足
      const injectProgress = await db.userWordProgress.findMany({
        where: { userId, wordId: { in: pool.map((w) => w.wordId) } },
        select: { wordId: true, mastery: true, skipped: true },
      });
      const injectProgressByWord = new Map(injectProgress.map((p) => [p.wordId, p]));
      const injectablePool = pool.filter((w) => {
        const p = injectProgressByWord.get(w.wordId);
        return !p?.skipped && (p?.mastery ?? 0) < 100;
      });
      fresh = injectablePool.filter((w) => !usedInRun.has(w.wordId)).slice(0, injected);
      const recycledNeed = Math.max(0, injected - fresh.length);
      const recycled = recycledNeed > 0
        ? await this.pickRecycled(userId, pool, recycledNeed, new Set(fresh.map((f) => f.wordId)), run.id, tx)
        : [];
      dayNewWords = [...fresh, ...recycled];
      const reviewNeed = questionsPerDay - dayNewWords.length;
      reviewPool = await this.pickReviews(
        userId, pool, usedInRun, reviewNeed, run.id, tx,
        new Set(dayNewWords.map((w) => w.wordId)),
      );
    }

    const dayWords = [...dayNewWords, ...reviewPool].slice(0, questionsPerDay).map((w) => ({
      wordId: w.wordId,
      word: w.word,
      source: (unitSources.get(w.wordId) ?? (fresh.includes(w) ? 'new' : 'review')) as 'new' | 'review' | 'wrongbook',
    }));
    if (dayWords.length === 0) return this.finishAfterDeath(userId, run, run.hp, tx, character.atkLv, character.defLv);

    // 候选预计算（持久化到 extra，续 Run 恢复不丢；advance 提交后由下一波覆盖/清除）
    // 传说技能：首领击破后仅 LEGEND_DROP_RATE 概率出三选一（稀有奖励）
    // unit（闯关）不做 buff 选择：不返回候选，RunFlow 自动跳过 pick 阶段
    const legendChoices =
      isUnit
        ? undefined
        : bossJustCleared && Math.random() < SURVIVAL.LEGEND_DROP_RATE
          ? pickLegends(Array.isArray(run.buffs) ? (run.buffs as string[]) : [])
          : undefined;
    const buffChoices = isUnit
      ? undefined
      : pickBuffs({
          hp: run.hp,
          maxHp: run.maxHp,
          codes: Array.isArray(run.buffs) ? (run.buffs as string[]) : [],
          day: nextDayNum,
          recentAcc: acc,
        });
    const pendingPick = writePendingPick(run.extra, isUnit ? { buffs: [], legends: [] } : { buffs: buffChoices ?? [], legends: legendChoices ?? [] });

    // 红宝书肉鸽词池扩展：双队列干净占比判定 → 达标则并池下一 Unit
    // 基于"上一波结束"的局内记忆（今日词尚未加入），保持扩展决策与实际战斗状态同步
    const expandInfo = await this.poolExpandInfo(userId, run, tx);
    let nextPooledUnits = curPooledUnits;
    let nextPoolExpand = expandInfo;
    if (expandInfo.canExpand && expandInfo.pooledStages.length > 0) {
      nextPooledUnits = curPooledUnits + 1;
      // 更新后的扩展信息（题量随之递增）
      const nextStages = computePoolStages(
        await this.bankStageIds(run.bankId, tx),
        run.stageId,
        nextPooledUnits,
      );
      const nextPooled = await this.stagePoolMany(run.bankId, nextStages, tx);
      const nextItems = await db.runItem.findMany({
        where: { runId: run.id },
        orderBy: { seq: 'asc' },
        select: { seq: true, wordId: true, correct: true },
      });
      const nextByWord = new Map<string, { seq: number; correct: boolean }[]>();
      for (const it of nextItems) {
        const list = nextByWord.get(it.wordId) ?? [];
        list.push({ seq: it.seq, correct: it.correct === true });
        nextByWord.set(it.wordId, list);
      }
      const nextMemories = nextPooled.map((w) => {
        const itemsOf = nextByWord.get(w.wordId);
        return itemsOf && itemsOf.length > 0 ? memoryOf(itemsOf) : { wrongCount: 0, streak: 0 };
      });
      nextPoolExpand = {
        pooledStages: nextStages,
        pooledUnits: nextPooledUnits,
        cleanRate: cleanRateOf(nextMemories),
        canExpand: false,
        questionsPerDay: questionsPerDayFor(nextPooledUnits),
      };
    }

    const pooledUnitsPersist =
      nextPooledUnits !== curPooledUnits
        ? ({ [POOLED_UNITS_KEY]: nextPooledUnits } as Record<string, unknown>)
        : undefined;
    const combinedExtra = {
      ...((pendingPick ?? {}) as Record<string, unknown>),
      ...(pooledUnitsPersist ?? {}),
    } as Prisma.InputJsonValue;

    let base = 0;
    const senseByWord = await this.senseIdxOf(userId, dayWords, tx);
    const commitCreate = async (t: Prisma.TransactionClient) => {
      const maxSeq = await t.runItem.aggregate({ where: { runId: run.id }, _max: { seq: true } });
      base = (maxSeq._max.seq ?? -1) + 1;
      await t.runItem.createMany({
        data: dayWords.map((w, i) => ({
          runId: run.id,
          seq: base + i,
          wordId: w.wordId,
          senseIdx: senseByWord.get(w.wordId) ?? 0,
          type: w.source,
        })),
      });
      return t.run.update({
        where: { id: run.id },
        data: { day: nextDayNum, hp: run.hp, maxHp: run.maxHp, lastInjectDay, extra: combinedExtra },
      });
    };
    const created = tx ? await commitCreate(tx) : await this.prisma.$transaction(commitCreate);

    const levels = await this.hintLevels(userId, dayWords.map((w) => w.wordId), tx);
    const questions = await this.buildDayQuestions(run.id, run.mode as GameMode, dayWords, base, tx, levels, senseByWord);
    const meta = await this.unitMeta(userId, run, tx);
    return {
      day: nextDayNum,
      hp: created.hp,
      maxHp: created.maxHp,
      buffs: created.buffs as string[],
      bossWave: false,
      bossCleared: false,
      ended: false,
      cleared: false,
      ...meta,
      combo: readCombo(run.extra),
      questions,
      previewWords: dayNewWords.map((w) => toLevelWord(w.word, fresh.includes(w) ? 'new' : 'review')),
      injectedNew: fresh.length,
      nextDayNewWords: fresh.length,
      poolExpand: nextPoolExpand,
      // 词池在注入前快照：加上本日 fresh 注入的新词数（均为池内未用词，去重）
      poolUsed: usedInRun.size + fresh.length,
      foilPool: run.mode === 'choice' ? buildFoilPool(pool) : undefined,
      legendChoices,
      buffChoices,
      atkLv: character.atkLv,
      defLv: character.defLv,
      executeSpec: character.executeSpec,
      vampireSpec: character.vampireSpec,
      recentAcc: acc,
      coins: await this.coinsOf(db, userId),
      rerolledToday: false,
      playSeconds: run.playSeconds ?? 0,
    };
  }

  // ── 预览斩词补词：从 stage 池挑一个未在本 Run 且未掌握的词加入待答题 ──  // ── 内部：首领波组题（本局错词压轴，题数=Boss 血量，不足自动补题）──
  /** 首领波响应（触发 / 未击破续战共用）：bossHp = 实际题数（与回放口径一致，词池不足时可击破） */
  private async bossWaveResponse(
    run: {
      id: number;
      bankId: number;
      stageId: number;
      mode: string;
      day: number;
      maxHp: number;
      buffs: unknown;
      kind?: string;
      finalBossHp?: number | null;
      playSeconds?: number | null;
      extra?: Prisma.JsonValue;
    },
    character: { atkLv: number; defLv: number; executeSpec?: boolean; vampireSpec?: boolean },
    userId: number,
    acc: number,
    combo: number,
    bossQuestions: RunQuestion[],
    hpNow: number,
    tx: Prisma.TransactionClient,
    // unit Final Boss 随机血量（服务端权威）；缺省按实际题数（survival 首领波）
    finalBossHpParam?: number,
  ): Promise<RunAdvanceResponse> {
    const meta = await this.unitMeta(userId, run, tx);
    return {
      day: run.day,
      hp: hpNow,
      maxHp: run.maxHp,
      buffs: run.buffs as string[],
      bossWave: true,
      bossCleared: false,
      ended: false,
      cleared: false,
      ...meta,
      combo,
      questions: bossQuestions,
      previewWords: [],
      injectedNew: 0,
      nextDayNewWords: 0,
      poolUsed: await this.runPoolUsed(run.id, tx),
      poolExpand: await this.poolExpandInfo(userId, run, tx),
      foilPool:
        run.mode === 'choice'
          ? buildFoilPool(await this.stagePoolMany(run.bankId, (await this.runPoolStages(run, tx)).stages, tx))
          : undefined,
      bossHp: finalBossHpParam ?? bossQuestions.length,
      atkLv: character.atkLv,
      defLv: character.defLv,
      executeSpec: character.executeSpec ?? false,
      vampireSpec: character.vampireSpec ?? false,
      recentAcc: acc,
      coins: await this.coinsOf(tx, userId),
      rerolledToday: false,
      playSeconds: run.playSeconds ?? 0,
    };
  }

  private async buildBossWave(
    runId: number,
    userId: number,
    mode: GameMode,
    day: number,
    atkLv: number,
    tx?: Prisma.TransactionClient,
    // 补题：未击破续战时按剩余 Boss 血量组题（默认按 bossHits 全量）
    needOverride?: number,
  ): Promise<RunQuestion[]> {
    const db = tx ?? this.prisma;
    const need = needOverride ?? bossHits(day, atkLv); // 无上限：Boss 血量 = 题数，随 day 正常成长
    if (need <= 0) return [];

    // 全部已答序列 → 每词局内记忆（含此前 Boss 波重考，答对累积连续 → 恢复）
    const answered = await db.runItem.findMany({
      where: { runId, answered: true },
      orderBy: { seq: 'asc' },
      select: { wordId: true, seq: true, correct: true, type: true },
    });
    const itemsByWord = new Map<string, { seq: number; correct: boolean }[]>();
    for (const it of answered) {
      if (it.correct === null) continue;
      const list = itemsByWord.get(it.wordId) ?? [];
      list.push({ seq: it.seq, correct: it.correct === true });
      itemsByWord.set(it.wordId, list);
    }
    const maxSeq = answered.length > 0 ? answered[answered.length - 1]!.seq : -1;

    // 全局进度：排除斩词（修 bug：斩词永不再考）+ 局前掌握度作初始记忆强度
    const progress = await db.userWordProgress.findMany({
      where: { userId, wordId: { in: [...itemsByWord.keys()] } },
      select: { wordId: true, mastery: true, skipped: true },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));
    const candidates = [...itemsByWord.entries()]
      .filter(([wordId]) => !progressByWord.get(wordId)?.skipped)
      .map(([wordId, items]) => ({
        wordId,
        memory: memoryOf(items),
        preMastery: (progressByWord.get(wordId)?.mastery ?? 0) / 100,
      }));

    // 上一波 Boss 已考词（最后一段连续 boss 序列）→ 本波软降权，拉长跨波间隔
    const lastBossWordIds = new Set<string>();
    let idx = answered.length - 1;
    while (idx >= 0 && answered[idx]!.type !== 'boss') idx--;
    if (idx >= 0) {
      lastBossWordIds.add(answered[idx]!.wordId);
      idx--;
      while (idx >= 0 && answered[idx]!.type === 'boss' && answered[idx]!.seq === answered[idx + 1]!.seq - 1) {
        lastBossWordIds.add(answered[idx]!.wordId);
        idx--;
      }
    }

    let ids = pickBossWords({
      candidates,
      need,
      maxSeq,
      lastBossWordIds,
      rng: Math.random,
    }).map((c) => c.wordId);

    // 错词不足：用词池加权循环抽词兜底（本局错+8/错题本+4/低掌握+2，已斩排除），保证题数=need（杜绝必败波）
    if (ids.length < need) {
      const run = await db.run.findUnique({
        where: { id: runId },
        select: { bankId: true, stageId: true, extra: true },
      });
      const bossRun = run
        ? { bankId: run.bankId, stageId: run.stageId, extra: run.extra }
        : null;
      const { stages: bossStages } = bossRun
        ? await this.runPoolStages(bossRun, tx)
        : { stages: [run?.stageId ?? 0] };
      const pool = await this.stagePoolMany(bossRun?.bankId ?? 0, bossStages, tx);
      const unique = await this.pickRecycled(userId, pool, need - ids.length, new Set(ids), runId, tx);
      ids = [...ids, ...unique.map((w) => w.wordId)];
      if (ids.length < need) {
        const reuse = await this.pickRecycled(userId, pool, need - ids.length, new Set(), runId, tx);
        ids = [...ids, ...reuse.map((w) => w.wordId)];
      }
    }
    ids = ids.slice(0, need);

    const levels = await this.hintLevels(userId, ids, tx);
    const wordRows = await this.loadWords(ids, tx);
    // Boss 题 seq 从当前 maxSeq 续接（不固定 9000），
    // 避免同 run 多次 Boss 波 seq 与既有行冲突（RunItem @@unique[runId, seq] → P2002 → 500）
    const bossBase = ((await db.runItem.aggregate({ where: { runId }, _max: { seq: true } }))._max.seq ?? -1) + 1;
    const senseByWord = await this.senseIdxOf(
      userId,
      [...wordRows.entries()].map(([wordId, word]) => ({ wordId, word })),
      tx,
    );
    const items = ids.map((wid, i) => {
      const w = wordRows.get(wid);
      return {
        seq: bossBase + i,
        wordId: wid,
        senseIdx: senseByWord.get(wid) ?? 0,
        type: 'boss' as const,
        runId,
      };
    });
    if (items.length > 0) {
      await db.runItem.createMany({ data: items });
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
            : (w?.senses[it.senseIdx]?.meaning ?? w?.senses[0]?.meaning ?? w?.text ?? ''),
        example: w?.senses[it.senseIdx]?.example,
        phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
        tier: (w?.tier ?? 'I') as DifficultyTier,
        mode,
        source: 'boss',
        hintLevel: levels.get(it.wordId) ?? 0,
        confusable: w ? confusableOf(w) : undefined,
        mnemonic: w?.mnemonic ?? undefined,
      });
      return { ...q, isNew: false };
    });
  }

  // ── 内部：逐题落库（按 对错×耗时 分组批量 updateMany，同时写入 elapsedMs）──
  private async persistAnswers(rows: { id: number; correct: boolean; elapsedMs: number }[], tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const groups = new Map<string, { ids: number[]; correct: boolean; elapsedMs: number }>();
    for (const r of rows) {
      const key = `${r.correct}:${r.elapsedMs}`;
      const g = groups.get(key) ?? { ids: [], correct: r.correct, elapsedMs: r.elapsedMs };
      g.ids.push(r.id);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      await db.runItem.updateMany({
        where: { id: { in: g.ids } },
        data: { answered: true, correct: g.correct, elapsedMs: g.elapsedMs },
      });
    }
  }

  // ── 内部：每波增量提交 SRS（词级 + 义项级）──
  // 与 sessions.submit 同口径：同词按答题顺序链式排程、错题本连续答对摘标、进本次日短间隔。
  // 按波调用（advance persistAnswers 后），避免整局结算才写库导致中途断档。
  private async commitWaveSrs(
    userId: number,
    runId: number,
    items: { wordId: string; senseIdx: number; correct: boolean }[],
    tx: Prisma.TransactionClient,
    dictation?: boolean,
  ): Promise<void> {
    if (items.length === 0) return;

    // 词级：按 wordId 顺序链式排程 + 错题本状态累计
    const byWord = new Map<string, (typeof items)[number][]>();
    for (const it of items) {
      const list = byWord.get(it.wordId) ?? [];
      list.push(it);
      byWord.set(it.wordId, list);
    }
    const wordIds = [...byWord.keys()];
    const progress = await tx.userWordProgress.findMany({ where: { userId, wordId: { in: wordIds } } });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));

    for (const [wordId, list] of byWord) {
      const cur = progressByWord.get(wordId);
      const srsBase = cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null;
      let srs = srsBase;
      const wb: WrongbookState = cur
        ? { inWrongBook: cur.inWrongBook, wrongStreak: cur.wrongStreak }
        : { inWrongBook: false, wrongStreak: 0 };
      for (const it of list) {
        srs = srsSchedule(srs, it.correct);
        // 听写精通：dictation 答对额外 +1 档（更快掌握，更高阶挑战的回报）
        if (dictation && it.correct) srs = srsSchedule(srs, true);
        const next = applyWrongbookState(wb, [{ correct: it.correct }]);
        wb.inWrongBook = next.inWrongBook;
        wb.wrongStreak = next.wrongStreak;
      }
      const s = srs ?? { reviewStage: 0, ease: 2.5 };
      const now = Date.now();
      // 进错题本 → 次日短间隔再考（与 sessions 同口径）
      const next = wb.inWrongBook
        ? new Date(now + intervalDays(1) * 86400000)
        : s.reviewStage > 0
          ? new Date(now + intervalDays(s.reviewStage) * 86400000)
          : null;
      const mastery = masteryFromStage(s.reviewStage);
      const newlyMastered = mastery >= 100 && (cur?.mastery ?? 0) < 100;

      await tx.userWordProgress.upsert({
        where: { userId_wordId: { userId, wordId } },
        create: {
          userId, wordId,
          correctCount: list.filter((i) => i.correct).length,
          wrongCount: list.filter((i) => !i.correct).length,
          inWrongBook: wb.inWrongBook,
          wrongStreak: wb.wrongStreak,
          inVocabBook: true,
          mastery,
          reviewStage: s.reviewStage,
          nextReviewAt: next,
          ease: s.ease,
          firstEncounteredAt: new Date(now),
          lastEncounteredAt: new Date(now),
          srsHistory: [{ stage: s.reviewStage, at: new Date(now).toISOString() }],
          masteredAt: newlyMastered ? new Date(now) : null,
        },
        update: {
          correctCount: { increment: list.filter((i) => i.correct).length },
          wrongCount: { increment: list.filter((i) => !i.correct).length },
          inWrongBook: wb.inWrongBook,
          wrongStreak: wb.wrongStreak,
          inVocabBook: true,
          mastery,
          reviewStage: s.reviewStage,
          nextReviewAt: next,
          ease: s.ease,
          firstEncounteredAt: cur ? undefined : new Date(now),
          lastEncounteredAt: new Date(now),
          srsHistory: appendStageHistory(cur?.srsHistory, cur?.reviewStage ?? 0, s.reviewStage, new Date(now)),
          masteredAt: newlyMastered ? new Date(now) : undefined,
        },
      });
    }

    // 义项级：按 senseIdx 链式排程（同一义项在同波多次出现按序累计）
    const bySense = new Map<string, (typeof items)[number][]>();
    for (const it of items) {
      const key = `${it.wordId}:${it.senseIdx}`;
      const list = bySense.get(key) ?? [];
      list.push(it);
      bySense.set(key, list);
    }
    for (const [key, list] of bySense) {
      const [wordId, senseIdxStr] = key.split(':');
      const senseIdx = Number(senseIdxStr);
      const cur = await tx.userSenseProgress.findUnique({
        where: { userId_wordId_senseIdx: { userId, wordId: wordId!, senseIdx } },
      });
      let srs = cur ? { reviewStage: cur.reviewStage, ease: cur.ease } : null;
      for (const it of list) {
        srs = srsSchedule(srs, it.correct);
        // 听写精通：与词级同口径，dictation 答对额外 +1 档
        if (dictation && it.correct) srs = srsSchedule(srs, true);
      }
      const s = srs ?? { reviewStage: 0, ease: 2.5 };
      const now = Date.now();
      const next = s.reviewStage > 0 ? new Date(now + intervalDays(s.reviewStage) * 86400000) : null;
      await tx.userSenseProgress.upsert({
        where: { userId_wordId_senseIdx: { userId, wordId: wordId!, senseIdx } },
        create: {
          userId, wordId: wordId!, senseIdx,
          reviewStage: s.reviewStage,
          nextReviewAt: next,
          ease: s.ease,
          correctCount: list.filter((i) => i.correct).length,
          lastTestedAt: new Date(now),
        },
        update: {
          reviewStage: s.reviewStage,
          nextReviewAt: next,
          ease: s.ease,
          correctCount: { increment: list.filter((i) => i.correct).length },
          lastTestedAt: new Date(now),
        },
      });
    }
  }

  // ── 内部：死亡结算 ──
  private async finishAfterDeath(
    userId: number,
    run: { id: number; bankId: number; hp: number; maxHp: number; day: number; stageId: number; kind?: string; cleared?: boolean; playSeconds?: number | null },
    finalHp: number,
    tx?: Prisma.TransactionClient,
    atkLv = 1,
    defLv = 1,
    // unit：Final Boss 击破 = 通关终局（响应标 bossWave/bossCleared/cleared）
    win = false,
  ): Promise<RunAdvanceResponse> {
    const finish = await this.settle(userId, run, false, tx);
    const meta = await this.unitMeta(userId, run, tx);
    return {
      day: run.day,
      hp: Math.max(0, finalHp),
      maxHp: run.maxHp,
      buffs: [],
      bossWave: win,
      bossCleared: win,
      ended: true,
      cleared: win,
      ...meta,
      combo: 0,
      result: finish,
      questions: [],
      previewWords: [],
      injectedNew: 0,
      nextDayNewWords: 0,
      poolUsed: await this.runPoolUsed(run.id, tx),
      atkLv,
      defLv,
      executeSpec: false,
      vampireSpec: false,
      recentAcc: undefined,
      coins: await this.coinsOf(tx ?? this.prisma, userId),
      rerolledToday: false,
      playSeconds: run.playSeconds ?? 0,
    };
  }

  // ── 内部：统一结算 ──
  private async settle(
    userId: number,
    run: { id: number; hp: number; day: number; stageId: number; kind?: string; mode?: string; cleared?: boolean; bossClearedCount?: number; maxCombo?: number; playSeconds?: number | null },
    surrender: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<RunFinish> {
    const db = tx ?? this.prisma;
    const character = await db.userCharacter.findUnique({ where: { userId } });
    if (!character) throw new BadRequestException('角色未初始化');

    // unit 结算按 kind 隔离纪录（不混 survival）
    const isUnit = run.kind === 'unit';
    const kindFilter = isUnit ? { kind: 'unit' } : {};

    // 历史最高（收枪不计破纪录）
    const prevBest = await db.run.findFirst({
      where: { userId, stageId: run.stageId, status: 'finished', ...kindFilter },
      orderBy: { day: 'desc' },
      select: { day: true },
    });
    const bestDays = Math.max(prevBest?.day ?? 0, run.day);
    const recordBroken = isRecordBroken(run.day, prevBest?.day ?? 0, surrender);

    // unit 首通：此前无 cleared unit Run（一次性加成，幂等）
    let unitFirstClear = false;
    if (isUnit && run.cleared) {
      const prior = await db.run.findFirst({
        where: {
          userId,
          stageId: run.stageId,
          kind: 'unit',
          status: 'finished',
          cleared: true,
          id: { not: run.id },
        },
        select: { id: true },
      });
      unitFirstClear = isFirstClear(!!prior);
    }

    // 正确率来自本局已答题
    const stats = await db.runItem.aggregate({
      where: { runId: run.id, answered: true },
      _count: true,
      _sum: { elapsedMs: true },
    });
    // 平均耗时只统计实际作答的题（斩词 elapsedMs=0 不计入，避免拉低平均导致评级虚高）
    const timedTotal = await db.runItem.count({
      where: { runId: run.id, answered: true, elapsedMs: { gt: 0 } },
    });
    const wrongItems = await db.runItem.count({
      where: { runId: run.id, answered: true, correct: false },
    });
    const total = stats._count;
    const correct = total - wrongItems;
    const acc = total > 0 ? correct / total : 0;

    const avgElapsedMs = timedTotal > 0 ? (stats._sum?.elapsedMs ?? 0) / timedTotal : 8000;
    const rating = computeRating({
      total: Math.max(1, total),
      correct,
      avgElapsedMs,
      perfectBonus: acc === 1,
    });
    const bossClearedCount = run.bossClearedCount ?? 0;

    // 奖励纯函数：xp/coins/材料稀有度（收枪 ×0.5）
    const rewards = computeRewards({
      rating,
      correctCount: correct,
      daysSurvived: run.day,
      bossClearedCount,
      surrender,
      perfect: acc === 1,
    });
    const xp = rewards.xp;
    // 听写精通：更高阶模式 xp ×1.5
    const xpFinal = run.mode === 'dictation' ? Math.round(xp * 1.5) : xp;
    let coins = rewards.coins;
    // unit 首通一次性加成（幂等：仅首个通关结算触发）
    if (unitFirstClear) coins += UNIT_BOSS.FIRST_CLEAR_COINS;
    const matTier = rewards.materialTier;
    const drops = rollDrops(rating).filter((d) => d.tier <= matTier);
    if (drops.length === 0 && matTier >= 1) {
      drops.push({ materialCode: 'essence_1', tier: 1, count: 1 });
    }

    const materialRows = await db.material.findMany({
      where: { code: { in: drops.map((d) => d.materialCode) } },
    });
    const matIdByCode = new Map(materialRows.map((m) => [m.code, m.id]));
    let wordStats: RunWordStats | undefined;

    const commit = async (t: Prisma.TransactionClient) => {
      const updated = await t.run.updateMany({
        where: { id: run.id, status: 'active' },
        data: {
          status: 'finished',
          hp: Math.max(0, run.hp),
          surrendered: surrender,
          recordBroken,
          // 结算统计落库（统计页/历史口径，与 LearningSession 对齐）
          rating,
          xpEarned: xpFinal,
          coinsEarned: coins,
        },
      });
      if (updated.count === 0) throw new BadRequestException('Run 已结算');

      await t.userCharacter.update({
        where: { userId },
        data: { exp: { increment: xpFinal } },
      });
      // 等级随经验重算写回（否则 level 恒 1，强化上限 level+4 永不增长）
      const charAfter = await t.userCharacter.findUnique({ where: { userId } });
      if (charAfter) {
        await t.userCharacter.update({
          where: { userId },
          data: { level: levelFromExp(charAfter.exp) },
        });
      }
      await t.user.update({ where: { id: userId }, data: { coins: { increment: coins } } });

      for (const d of drops) {
        const mid = matIdByCode.get(d.materialCode);
        if (!mid) continue;
        await t.userMaterial.upsert({
          where: { userId_materialId: { userId, materialId: mid } },
          update: { count: { increment: d.count } },
          create: { userId, materialId: mid, count: d.count },
        });
      }

      // 词数统计（结算页展示）：新认识/复习/易错/掌握
      // SRS 已由每波 commitWaveSrs 增量提交；此处仅本地重放算出各词最终掌握度用于统计，不再写库
      const items = await t.runItem.findMany({ where: { runId: run.id } });
      const itemsByWord = new Map<string, (typeof items)[number][]>();
      for (const item of items) {
        const list = itemsByWord.get(item.wordId) ?? [];
        list.push(item);
        itemsByWord.set(item.wordId, list);
      }
      const wordIds = [...itemsByWord.keys()];
      const progress = await t.userWordProgress.findMany({ where: { userId, wordId: { in: wordIds } } });
      const progressByWord = new Map(progress.map((p) => [p.wordId, p]));
      let newLearned = 0;
      let reviewed = 0;
      const wrongIds = new Set<string>();
      const masteredIds = new Set<string>();
      for (const [wordId, list] of itemsByWord) {
        if (list.some((i) => i.type === 'new')) newLearned++;
        if (list.some((i) => i.type === 'review' || i.type === 'wrongbook')) reviewed++;
        if (list.some((i) => i.correct === false)) wrongIds.add(wordId);
        const p = progressByWord.get(wordId);
        const srsBase = p ? { reviewStage: p.reviewStage, ease: p.ease } : null;
        let srs = srsBase;
        for (const item of list) {
          if (item.correct === null) continue; // 未答题不参与 SRS 排程
          srs = srsSchedule(srs, item.correct);
        }
        if (srs && srs.reviewStage >= MASTER_STAGE) masteredIds.add(wordId);
      }
      wordStats = {
        totalWords: itemsByWord.size,
        newLearned,
        reviewed,
        mastered: masteredIds.size,
        wrong: wrongIds.size,
      };
    };
    if (tx) {
      await commit(tx);
    } else {
      await this.prisma.$transaction(commit);
    }

    return {
      runId: run.id,
      daysSurvived: run.day,
      bossClearedCount,
      bestDays,
      recordBroken,
      surrendered: surrender,
      cleared: run.cleared ?? false,
      unitFirstClear: isUnit && unitFirstClear ? true : undefined,
      xp,
      coins,
      materials: drops.map((d) => ({ materialCode: d.materialCode, tier: d.tier, count: d.count })),
      rating,
      wordStats,
      maxCombo: run.maxCombo ?? 0,
      playSeconds: run.playSeconds ?? 0,
    };
  }

  // ── 内部：首日混合抽词（7:2:1：新词/复习/错题本，缺额新词补足；与普通模式同源）──
  private async mixFirstDay(
    userId: number,
    pool: { wordId: string; word: WordRow }[],
    tx?: Prisma.TransactionClient,
  ): Promise<{ wordId: string; word: WordRow; source: 'new' | 'review' | 'wrongbook' }[]> {
    const db = tx ?? this.prisma;
    const size = Math.min(SURVIVAL.QUESTIONS_PER_DAY, pool.length);
    if (size <= 0) return [];

    const progress = await db.userWordProgress.findMany({
      where: { userId, wordId: { in: pool.map((w) => w.wordId) } },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));
    // 已斩/已掌握词整体剔除（不再出题；已掌握按长间隔复习，不入首日混合）
    const activePool = pool.filter((w) => {
      const p = progressByWord.get(w.wordId);
      return !p?.skipped && (p?.mastery ?? 0) < 100;
    });

    const classify = (bw: { wordId: string }): 'new' | 'review' | 'wrongbook' => {
      const p = progressByWord.get(bw.wordId);
      if (p?.inWrongBook) return 'wrongbook';
      if (p && p.reviewStage > 0) return 'review';
      return 'new';
    };

    const dueFirst = (bw: { wordId: string }): number => {
      const p = progressByWord.get(bw.wordId);
      if (!p?.nextReviewAt) return 0;
      return p.nextReviewAt.getTime() - Date.now();
    };

    const fresh = [...activePool.filter((w) => classify(w) === 'new')].sort(() => Math.random() - 0.5);
    const review = activePool.filter((w) => classify(w) === 'review').sort((a, b) => dueFirst(a) - dueFirst(b));
    const wrongbook = [...activePool.filter((w) => classify(w) === 'wrongbook')].sort(() => Math.random() - 0.5);

    return allocSessionMix({ fresh, review, wrongbook, size }).map((w) => ({
      wordId: w.wordId,
      word: w.word,
      source: classify(w),
    }));
  }

  // ── 内部：词池（单 stage）──
  private async stagePool(bankId: number, stageId: number, tx?: Prisma.TransactionClient) {
    return this.stagePoolMany(bankId, [stageId], tx);
  }

  // ── 内部：词池（多 stage 并池，红宝书跨关卡扩展用）──
  private async stagePoolMany(bankId: number, stageIds: number[], tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const rows = await db.bankWord.findMany({
      where: { bankId, stage: { in: stageIds } },
      orderBy: [{ word: { difficultyScore: 'asc' } }, { wordId: 'asc' }],
      include: {
        word: {
          include: {
            senses: { orderBy: { idx: 'asc' } },
            confusableA: { include: { wordB: { select: { text: true } } } },
            confusableB: { include: { wordA: { select: { text: true } } } },
          },
        },
      },
    });
    return rows as unknown as { wordId: string; word: WordRow }[];
  }

  // ── 内部：红宝书分层词书的全部 stage（升序，跨区域 Unit 顺序）──
  private async bankStageIds(bankId: number, tx?: Prisma.TransactionClient): Promise<number[]> {
    const db = tx ?? this.prisma;
    const rows = await db.bankWord.findMany({
      where: { bankId },
      distinct: ['stage'],
      select: { stage: true },
    });
    return rows.map((r) => r.stage).sort((a, b) => a - b);
  }

  // ── 内部：读取 Run 当前已并池 Unit 数（extra.__pooledUnits，默认 1）──
  private pooledUnitsOf(run: { extra?: Prisma.JsonValue }): number {
    const e = (run.extra ?? {}) as Record<string, unknown>;
    return typeof e[POOLED_UNITS_KEY] === 'number' && (e[POOLED_UNITS_KEY] as number) >= 1
      ? (e[POOLED_UNITS_KEY] as number)
      : 1;
  }

  // ── 内部：当前 Run 应使用的词池 stage 列表 ──
  // unit（红宝书 Unit 肉鸽）：恒为单 stage（该 Unit），不做跨 Unit 并池；
  // survival（旧生存 Run）：红宝书=扩展池；其他词书=单 stage
  private async runPoolStages(
    run: { bankId: number; stageId: number; kind?: string; extra?: Prisma.JsonValue },
    tx?: Prisma.TransactionClient,
  ): Promise<{ stages: number[]; pooledUnits: number }> {
    if (run.kind === 'unit' || run.stageId < 100) {
      // unit Run / 非分层词书（如 kaoyan_engl1 stage 1~4）：保持单 stage 语义
      return { stages: [run.stageId], pooledUnits: 1 };
    }
    const all = await this.bankStageIds(run.bankId, tx);
    const pooledUnits = this.pooledUnitsOf(run);
    return {
      stages: computePoolStages(all, run.stageId, pooledUnits),
      pooledUnits,
    };
  }

  // ── 内部：计算并池扩展信息（双队列干净占比 → 是否已达扩展阈值 → 每日题量）──
  private async poolExpandInfo(
    userId: number,
    run: { id: number; bankId: number; stageId: number; kind?: string; extra?: Prisma.JsonValue },
    tx?: Prisma.TransactionClient,
  ): Promise<PoolExpandInfo> {
    if (run.kind === 'unit') {
      // unit Run：不跨 Unit 并池，HUD 不展示扩展信息
      return { pooledStages: [], pooledUnits: 1, cleanRate: 1, canExpand: false, questionsPerDay: UNIT_BOSS.DAILY_CAP };
    }
    const { stages, pooledUnits } = await this.runPoolStages(run, tx);
    if (run.stageId < 100) {
      return { pooledStages: [], pooledUnits: 1, cleanRate: 1, canExpand: false, questionsPerDay: SURVIVAL.QUESTIONS_PER_DAY };
    }
    const pool = await this.stagePoolMany(run.bankId, stages, tx);
    if (pool.length === 0) {
      return { pooledStages: stages, pooledUnits, cleanRate: 1, canExpand: false, questionsPerDay: questionsPerDayFor(pooledUnits) };
    }
    // 局内记忆（RunItem 序列）→ 每词双队列状态
    const items = await (tx ?? this.prisma).runItem.findMany({
      where: { runId: run.id },
      orderBy: { seq: 'asc' },
      select: { seq: true, wordId: true, correct: true },
    });
    const byWord = new Map<string, { seq: number; correct: boolean }[]>();
    for (const it of items) {
      const list = byWord.get(it.wordId) ?? [];
      list.push({ seq: it.seq, correct: it.correct === true });
      byWord.set(it.wordId, list);
    }
    // 池内词 + 已出过题的词记忆；未出现过的词视为 clean（从未错）
    const memories = pool.map((w) => {
      const itemsOf = byWord.get(w.wordId);
      return itemsOf && itemsOf.length > 0 ? memoryOf(itemsOf) : { wrongCount: 0, streak: 0 };
    });
    const cleanRate = cleanRateOf(memories);
    return {
      pooledStages: stages,
      pooledUnits,
      cleanRate,
      canExpand: shouldExpand(cleanRate),
      questionsPerDay: questionsPerDayFor(pooledUnits),
    };
  }

  // ── 内部：Unit Run 每词状态（局前掌握度 + 局内作答序列聚合）──
  private async unitWordStates(
    userId: number,
    bankId: number,
    stageId: number,
    runId?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<UnitWordState[]> {
    const db = tx ?? this.prisma;
    const pool = await this.stagePoolMany(bankId, [stageId], tx);
    if (pool.length === 0) return [];
    const ids = pool.map((w) => w.wordId);
    const [progress, items] = await Promise.all([
      db.userWordProgress.findMany({
        where: { userId, wordId: { in: ids } },
        select: { wordId: true, mastery: true, correctCount: true, inWrongBook: true, skipped: true },
      }),
      runId
        ? db.runItem.findMany({
            where: { runId },
            orderBy: { seq: 'asc' },
            select: { wordId: true, seq: true, correct: true, elapsedMs: true },
          })
        : Promise.resolve([]),
    ]);
    const progByWord = new Map(progress.map((p) => [p.wordId, p]));
    const itemsByWord = new Map<string, { seq: number; correct: boolean; elapsedMs: number }[]>();
    for (const it of items) {
      if (it.correct === null) continue;
      const list = itemsByWord.get(it.wordId) ?? [];
      list.push({ seq: it.seq, correct: it.correct === true, elapsedMs: it.elapsedMs });
      itemsByWord.set(it.wordId, list);
    }
    return ids.map((id) => {
      const p = progByWord.get(id);
      const itemsOf = itemsByWord.get(id);
      const mem = itemsOf ? memoryOf(itemsOf) : emptyMemory();
      return {
        wordId: id,
        preKnown: (p?.correctCount ?? 0) >= 1,
        preMastery: p?.mastery ?? 0,
        inWrongBook: p?.inWrongBook ?? false,
        rc: mem.correctCount,
        wrongCount: mem.wrongCount,
        streak: mem.streak,
        hasSlowWrong: (itemsOf ?? []).some((it) => !it.correct && it.elapsedMs >= UNIT_BOSS.SLOW_WRONG_MS),
        served: (itemsOf?.length ?? 0) > 0,
        skipped: p?.skipped ?? false,
      };
    });
  }

  // ── 内部：Unit Run 通关进度（已会词数 / 总词数，排除已斩）──
  private async unitProgress(
    userId: number,
    bankId: number,
    stageId: number,
    runId?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{ total: number; doneCount: number; doneAll: boolean }> {
    const states = await this.unitWordStates(userId, bankId, stageId, runId, tx);
    return unitProgressOfFn(states);
  }

  // ── 内部：Unit Run 响应附带元信息（masteredCount=已会词数/totalCount/finalBossHp；非 unit 恒空）──
  private async unitMeta(
    userId: number,
    run: { id?: number; bankId: number; stageId: number; kind?: string; finalBossHp?: number | null },
    tx?: Prisma.TransactionClient,
  ): Promise<{ masteredCount?: number; totalCount?: number; finalBossHp?: number }> {
    if (run.kind !== 'unit') return {};
    const { total, doneCount } = await this.unitProgress(userId, run.bankId, run.stageId, run.id, tx);
    return { masteredCount: doneCount, totalCount: total, finalBossHp: run.finalBossHp ?? undefined };
  }

  // ── 内部：累计新词消耗（DB 统计）──
  private consumedNewCount(runId: number, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? this.prisma;
    return db.runItem.count({ where: { runId, type: 'new' } });
  }

  // ── 内部：本局词池大小（累计去重词数；day1=20，注入逐日增加）──
  private async runPoolUsed(runId: number, tx?: Prisma.TransactionClient): Promise<number> {
    const db = tx ?? this.prisma;
    const rows = await db.runItem.findMany({ where: { runId }, select: { wordId: true } });
    return new Set(rows.map((r) => r.wordId)).size;
  }

  // 近期正确率（近 N 道已答，与 buff-picker/inject 的 acc 口径一致；无数据返回 undefined）
  private async recentAccOf(runId: number, tx?: Prisma.TransactionClient): Promise<number | undefined> {    const db = tx ?? this.prisma;
    const rows = await db.runItem.findMany({
      where: { runId, answered: true },
      orderBy: { seq: 'desc' },
      take: 20,
      select: { correct: true },
    });
    const n = rows.length;
    if (n === 0) return undefined;
    return rows.filter((r) => r.correct).length / n;
  }

  // ── 内部：每词拼写提示强度（按用户掌握度/复习次数定档；新词由调用方强制 L0）──
  private async hintLevels(
    userId: number,
    wordIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, HintLevel>> {
    const db = tx ?? this.prisma;
    if (wordIds.length === 0) return new Map();
    const rows = await db.userWordProgress.findMany({ where: { userId, wordId: { in: wordIds } } });
    return new Map(rows.map((p) => [p.wordId, hintLevelFor(p.mastery, p.reviewStage)]));
  }

  // ── 内部：义项轮换（多义词逐义项独立 SRS，未测义项最优先）──
  // 返回 wordId → senseIdx；单义项词恒 0。与 sessions/普通模式同源 rotateSense。
  private async senseIdxOf(
    userId: number,
    words: { wordId: string; word: WordRow }[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    const db = tx ?? this.prisma;
    const multi = words.filter((w) => w.word.senses.length > 1);
    const out = new Map<string, number>();
    for (const w of words) out.set(w.wordId, 0);
    if (multi.length === 0) return out;

    const sps = await db.userSenseProgress.findMany({
      where: { userId, wordId: { in: multi.map((w) => w.wordId) } },
    });
    const spByWord = new Map<string, typeof sps>();
    for (const sp of sps) {
      const list = spByWord.get(sp.wordId) ?? [];
      list.push(sp);
      spByWord.set(sp.wordId, list);
    }
    for (const w of multi) {
      const states = Array.from({ length: w.word.senses.length }, (_, idx) => {
        const sp = spByWord.get(w.wordId)?.find((x) => x.senseIdx === idx);
        return {
          idx,
          reviewStage: sp?.reviewStage ?? 0,
          lastTestedAt: sp ? (sp.lastTestedAt?.getTime() ?? 0) : Number.MIN_SAFE_INTEGER,
        };
      });
      out.set(w.wordId, rotateSense(states));
    }
    return out;
  }

  // ── 内部：用户金币余额（重抽显示/校验用）──
  private async coinsOf(db: PrismaService | Prisma.TransactionClient, userId: number): Promise<number> {
    const u = await db.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return u?.coins ?? 0;
  }

  // ── 内部：复习选词（局内遗忘曲线：双队列 + 记忆强度衰减 + 随机抖动）──
  // 候选 = 本局已用 ∪ 全局错题本 ∪ 日历到期（skipped 排除）；
  // 每词从 RunItem 推导局内记忆（无局内记录时按全局信号伪造初始记忆），
  // 结合局前掌握度作初始记忆强度，按遗忘紧迫度降序取 need 个
  private async pickReviews(
    userId: number,
    pool: { wordId: string; word: WordRow }[],
    used: Set<string>,
    need: number,
    runId: number,
    tx?: Prisma.TransactionClient,
    usedInDay?: Set<string>,
  ): Promise<{ wordId: string; word: WordRow }[]> {
    if (need <= 0) return [];
    const db = tx ?? this.prisma;

    // 局内作答序列（按 seq 升序）→ 聚合每词记忆
    const runItems = await db.runItem.findMany({
      where: { runId, answered: true },
      orderBy: { seq: 'asc' },
      select: { wordId: true, seq: true, correct: true },
    });
    const itemsByWord = new Map<string, { seq: number; correct: boolean }[]>();
    for (const it of runItems) {
      if (it.correct === null) continue;
      const list = itemsByWord.get(it.wordId) ?? [];
      list.push({ seq: it.seq, correct: it.correct === true });
      itemsByWord.set(it.wordId, list);
    }
    const maxSeq = runItems.length > 0 ? runItems[runItems.length - 1]!.seq : -1;

    // 全局进度（错题本标记 / 掌握度 / 到期时间 / 斩词）
    const progress = await db.userWordProgress.findMany({
      where: { userId, wordId: { in: pool.map((w) => w.wordId) } },
      select: { wordId: true, inWrongBook: true, mastery: true, nextReviewAt: true, skipped: true },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));
    const now = Date.now();

    // 无局内记录时的兜底紧迫度：全局错题本视为"昨日答错"（高紧迫），日历到期给中等紧迫
    const fallbackUrgencyFor = (p: { inWrongBook: boolean; nextReviewAt: Date | null } | undefined): number | undefined => {
      if (p?.inWrongBook) return SURVIVAL.FORGETTING.WRONG_URGENCY_BASE;
      if (p?.nextReviewAt && p.nextReviewAt.getTime() <= now) return SURVIVAL.FORGETTING.FALLBACK_DUE_URGENCY;
      return undefined;
    };

    const candidates = pool
      .filter((w) => {
        const p = progressByWord.get(w.wordId);
        if (p?.skipped) return false; // 已斩词永不复习
        if (used.has(w.wordId)) return true;
        if (p?.inWrongBook) return true;
        if (p?.nextReviewAt && p.nextReviewAt.getTime() <= now) return true;
        return false;
      })
      .map((w) => {
        const p = progressByWord.get(w.wordId);
        const items = itemsByWord.get(w.wordId);
        return {
          wordId: w.wordId,
          word: w.word,
          memory: items ? memoryOf(items) : emptyMemory(),
          preMastery: (p?.mastery ?? 0) / 100,
          fallbackUrgency: fallbackUrgencyFor(p),
        };
      });

    const picked = pickReviewWords({ candidates, need, maxSeq, usedInDay, rng: Math.random });
    const pickedIds = new Set(picked.map((c) => c.wordId));
    return pool.filter((w) => pickedIds.has(w.wordId));
  }

  // ── 内部：词池循环抽词（加权随机：本局错优先 → 全局错题本 → 低掌握 → 随机）──
  // 池尽时从整个词池（含已用/已掌握）循环抽，保证注入量与 Boss 波题数足量
  private async pickRecycled(
    userId: number,
    pool: { wordId: string; word: WordRow }[],
    count: number,
    exclude: Set<string>,
    runId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{ wordId: string; word: WordRow }[]> {
    if (count <= 0 || pool.length === 0) return [];
    const db = tx ?? this.prisma;

    const runWrong = new Set(
      (await db.runItem.findMany({
        where: { runId, answered: true, correct: false },
        select: { wordId: true },
      })).map((w) => w.wordId),
    );
    const progress = await db.userWordProgress.findMany({
      where: { userId, wordId: { in: pool.map((w) => w.wordId) } },
      select: { wordId: true, inWrongBook: true, mastery: true, skipped: true },
    });
    const progressByWord = new Map(progress.map((p) => [p.wordId, p]));

    // 已斩词永不循环复用（斩=永久不再考）
    const candidates = pool.filter((w) => !exclude.has(w.wordId) && !progressByWord.get(w.wordId)?.skipped);
    return pickWeighted(candidates, count, (w) => {
      let wt = 1;
      if (runWrong.has(w.wordId)) wt += 8; // 本局错最优先
      if (progressByWord.get(w.wordId)?.inWrongBook) wt += 4;
      if ((progressByWord.get(w.wordId)?.mastery ?? 0) < 50) wt += 2;
      return wt;
    });
  }

  // ── 内部：组题（seq 从 startSeq 递增，逐词来源标记；hintLevels 为词→提示强度，缺省全 L0）──
  private async buildDayQuestions(
    runId: number,
    mode: GameMode,
    words: { wordId: string; word: WordRow; source: 'new' | 'review' | 'wrongbook' }[],
    startSeq: number,
    tx?: Prisma.TransactionClient,
    hintLevels?: Map<string, HintLevel>,
    senseByWord?: Map<string, number>,
  ): Promise<RunQuestion[]> {
    const wordRows = await this.loadWords(words.map((w) => w.wordId), tx);
    return words.map((pw, i) => {
      const w = wordRows.get(pw.wordId);
      const senseIdx = senseByWord?.get(pw.wordId) ?? 0;
      const q = buildQuestion({
        seq: startSeq + i,
        wordId: pw.wordId,
        senseIdx,
        text: w?.text ?? '',
        promptBase:
          mode === 'dictation'
            ? (w?.phoneticAm ?? w?.phoneticEn ?? '')
            : (w?.senses[senseIdx]?.meaning ?? w?.senses[0]?.meaning ?? w?.text ?? ''),
        example: w?.senses[senseIdx]?.example,
        phonetic: w?.phoneticAm ?? w?.phoneticEn ?? undefined,
        tier: (w?.tier ?? 'I') as DifficultyTier,
        mode,
        source: pw.source,
        hintLevel: pw.source === 'new' ? 0 : (hintLevels?.get(pw.wordId) ?? 0),
        confusable: w ? confusableOf(w) : undefined,
        mnemonic: w?.mnemonic ?? undefined,
      });
      return { ...q, isNew: pw.source === 'new' };
    });
  }

  // ── 内部：加载单词 ──
  private async loadWords(wordIds: string[], tx?: Prisma.TransactionClient): Promise<Map<string, WordRow>> {
    const db = tx ?? this.prisma;
    if (wordIds.length === 0) return new Map();
    const rows = await db.word.findMany({
      where: { id: { in: [...new Set(wordIds)] } },
      include: {
        senses: { orderBy: { idx: 'asc' } },
        confusableA: { include: { wordB: { select: { text: true } } } },
        confusableB: { include: { wordA: { select: { text: true } } } },
      },
    });
    return new Map(rows.map((w) => [w.id, w]));
  }

  // ── 内部：关闭旧 active Run（收枪语义，按 kind 区分：unit / survival 各自单活跃）──
  private async closeActive(userId: number, kind: RunKind = 'unit', tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const active = await db.run.findFirst({
      where: { userId, kind, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) return;
    await this.settle(userId, active, true, tx);
  }
}

// ── 工具 ──
function toRunInfo(run: {
  id: number;
  bankId: number;
  stageId: number;
  mode: string;
  kind: string;
  day: number;
  hp: number;
  maxHp: number;
  buffs: Prisma.JsonValue;
  status: string;
  surrendered: boolean;
  cleared: boolean;
  createdAt: Date;
  playSeconds?: number | null;
}): RunInfo {
  return {
    id: run.id,
    bankId: run.bankId,
    stageId: run.stageId,
    mode: run.mode as GameMode,
    kind: (run.kind ?? 'unit') as RunKind,
    day: run.day,
    hp: run.hp,
    maxHp: run.maxHp,
    buffs: Array.isArray(run.buffs) ? (run.buffs as string[]) : [],
    status: run.status as 'active',
    surrendered: run.surrendered,
    cleared: run.cleared ?? false,
    createdAt: run.createdAt.toISOString(),
    playSeconds: run.playSeconds ?? 0,
  };
}

function toLevelWord(w: WordRow, status: LevelWord['status'] = 'new'): LevelWord {
  return {
    wordId: w.id,
    text: w.text,
    phonetic: w.phoneticAm ?? w.phoneticEn ?? undefined,
    tier: w.tier,
    status,
    meanings: w.senses.map((s) => ({ meaning: s.meaning, example: s.example })),
    confusable: confusableOf(w),
    mnemonic: w.mnemonic ?? undefined,
  };
}

// tier 'I'..'IV' → 引擎下标 0..3
function tierToIdx(tier?: string): TierIdx {
  return tier === 'I' ? 0 : tier === 'II' ? 1 : tier === 'III' ? 2 : tier === 'IV' ? 3 : 0;
}

// 未决 buff/传说候选：持久化于 run.extra，续 Run（getActive）恢复不丢
interface PendingPick {
  buffs?: string[];
  legends?: string[];
  rerolledDay?: number; // 本波已重抽的天数（每波 1 次）
}
const PICK_KEY = '__pendingPick';

function readPendingPick(extra: Prisma.JsonValue | null): { buffs: string[]; legends: string[]; rerolledDay?: number } {
  const e = (extra ?? {}) as Record<string, unknown>;
  const p = e[PICK_KEY] as PendingPick | undefined;
  return {
    buffs: Array.isArray(p?.buffs) ? (p!.buffs as string[]) : [],
    legends: Array.isArray(p?.legends) ? (p!.legends as string[]) : [],
    rerolledDay: typeof p?.rerolledDay === 'number' ? p!.rerolledDay : undefined,
  };
}

function writePendingPick(extra: Prisma.JsonValue | null, p: PendingPick): Prisma.InputJsonValue {
  const e = (extra ?? {}) as Record<string, unknown>;
  return {
    ...e,
    [PICK_KEY]: {
      buffs: p.buffs ?? [],
      legends: p.legends ?? [],
      ...(typeof p.rerolledDay === 'number' ? { rerolledDay: p.rerolledDay } : {}),
    },
  };
}

// 局内全局连击（跨波累计，错答归零）：持久化于 extra，advance 重放后写回
const COMBO_KEY = '__combo';

// 红宝书肉鸽词池跨关卡扩展：已并池 Unit 数（1 = 仅起始 Unit）
const POOLED_UNITS_KEY = '__pooledUnits';

function readCombo(extra: Prisma.JsonValue | null): number {
  const e = (extra ?? {}) as Record<string, unknown>;
  return typeof e[COMBO_KEY] === 'number' ? (e[COMBO_KEY] as number) : 0;
}

// 应用 buff 选择（普通 buff / 传说技能，按 BUFF_DEFS 上限），返回是否生效
function applyBuffChoice(run: { buffs: Prisma.JsonValue; maxHp: number }, choice: string): boolean {
  const def = BUFF_DEFS[choice];
  if (!def) return false;
  const arr = Array.isArray(run.buffs) ? (run.buffs as string[]) : [];
  const count = arr.filter((b) => b === choice).length;
  if (count >= def.cap) return false;
  arr.push(choice);
  run.buffs = arr;
  if (choice === 'maxhp') run.maxHp += SURVIVAL.BUFF_MAXHP;
  return true;
}