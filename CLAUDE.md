# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**单词之旅**：一款"打字背单词"的 Web 游戏，把中译英/听写打字包装成即时战斗打怪，用闯关、连击、评级、养成构成游戏化学习闭环。当前主要开发方向是"生存 Run"模式（无限生存、肉鸽 buff、状态跨天继承）。

pnpm monorepo，无 root README；详细设计与进度记录在两份 Obsidian 风格的计划文档里，**是理解需求背景的第一手资料**，改动前应先查阅相关章节：

- `项目计划-v1.md` —— 主线 v1 设计（词汇学习机制、出题契约、即时战斗、成长系统、数据模型全貌）
- `生存模式执行计划.md` —— 生存 Run 模式的独立执行依据（数值模型、API 契约、里程碑），**关于生存模式以此文件为准**，其"实施进度"表格反映各里程碑真实完成状态

这两份文档会滞后于代码（例如战斗引擎注释里的版本号常常比计划文档更新），出现冲突时以代码 + 对应 `*.spec.ts` 为准。

## 常用命令

包管理器固定为 `pnpm@10.32.1`（见 `package.json` 的 `packageManager`），Node 需 ≥20.19.0。

```bash
pnpm install                 # 安装依赖（monorepo 根目录执行）

# 数据库
pnpm db:create                # 幂等创建 MySQL 库 word_journey（读 .env 的 MYSQL_*）
pnpm db:migrate               # prisma migrate dev（schema 在 db/schema.prisma）
pnpm db:generate              # prisma generate
pnpm db:studio                # 打开 Prisma Studio

# 开发
pnpm dev                      # 启动前端 (apps/web, vite)
pnpm dev:api                  # 启动后端 (apps/api, nest start --watch)

# 全量校验（对应 CI: pnpm typecheck / build / test，无独立顶层 lint 脚本聚合）
pnpm build                    # pnpm -r --workspace-concurrency=1 run build（各包顺序 build）
pnpm typecheck                # 各包 tsc --noEmit
pnpm test                     # 各包测试全量跑一遍
pnpm lint                     # 目前 api/web 均为占位 echo，无实际 lint 规则
```

各子包目前**没有共享的顶层 test/typecheck runner**，`pnpm -r run test` 只是依次调用每个包自己的 `test` 脚本；单独跑某一层最常用：

```bash
# 后端（NestJS + Jest，rootDir=src，仅匹配 *.spec.ts）
pnpm --filter @word-journey/api test                       # 全部
pnpm --filter @word-journey/api exec jest runs/boss-trigger # 按路径/文件名过滤
pnpm --filter @word-journey/api exec jest -t "某个 describe/it 名"

# 前端（Vitest）
pnpm --filter @word-journey/web test                        # vitest run（*.test.ts）
pnpm --filter @word-journey/web exec vitest run src/lib/survivalBattle.test.ts

# packages/shared（Vitest，含核心生存引擎单测 survival.spec.ts）
pnpm --filter @word-journey/shared test

# db 层：Prisma pipeline 纯函数（难度评分/易混词对/质量校验），Vitest 只扫 pipeline/**/*.spec.ts
pnpm --filter @word-journey/db test
pnpm --filter @word-journey/db exec vitest run pipeline/difficulty.spec.ts

# 平衡性蒙特卡洛仿真（生存模式数值标定，见 生存模式执行计划.md §4.9）
pnpm --filter @word-journey/api exec ts-node src/runs/balance-sim.ts
```

`db/package.json` 里还有词库导入相关脚本：`pnpm --filter @word-journey/db run pipeline:import / pipeline:check / pipeline:pairs / seed`（分别对应导入、质量校验、易混词对生成、种子数据写入，均读写 `db/data/*.json`，这些 JSON 源数据体积大，不入库，需自行准备）。

本地起 MySQL 用 `docker-compose.yml`（服务名 `mysql` + `api`），`.env` 从 `.env.example` 复制。

## 架构

### Monorepo 结构

```
apps/web/       React 19 + Vite + TypeScript 前端
apps/api/       NestJS + Prisma 后端
packages/shared/  前后端共享 TS 类型/纯函数（唯一的协议/数值真源）
db/             schema.prisma + migrations + 词库数据管线 + seed
```

`pnpm-workspace.yaml` 声明 `apps/*` `packages/*` `db` 为工作区；`@word-journey/shared` 被 web 与 api 同时以 `workspace:*` 依赖，**任何题面协议、游戏事件类型、生存模式数值表的改动都先改 `packages/shared/src`，再联动两端**。shared 内部用 `.js` 扩展名的相对导入（ESM + `exports` 双条件），api 侧 Jest 用 `moduleNameMapper` 把 `@word-journey/shared` 指回 `packages/shared/src/index.ts` 源码而非编译产物，改 shared 后无需重新 build 即可让 api 的测试生效。

### 核心设计原则：出题与判定服务端权威化

客户端只做题面回显与按键采集，**所有决定"对不对/扣多少血/发不发新词"的逻辑都在服务端跑**，且都写成不依赖 HTTP 的纯函数模块，单独有 `*.spec.ts`：

- `apps/api/src/questions/question-builder.ts` —— 抽词（新词:复习:错题 = 60:25:15）、义项轮换接入、易混词补抽、挖空模板
- `apps/api/src/sessions/settlement.ts` —— 评级(C~SSS)/经验/金币/掉落/SRS 词级与义项级排程更新
- `apps/api/src/runs/` 下的一组纯函数（生存 Run 专用）：`inject.ts`（千词池新词注入门控）、`review-queue.ts`（复习优先级排序）、`boss-trigger.ts`（Boss 双驱动触发判定）、`buff-picker.ts`（上下文感知 buff 候选池）、`rewards.ts`（结算奖励/破纪录）、`balance-sim.ts`（数值标定用蒙特卡洛仿真）

`packages/shared/src/survival.ts` 是生存战斗引擎的**单一权威实现**：按题驱动（每答一题调一次 `step(correct)`），维护怪场/HP/连击/Boss 状态并产出逐题事件；服务端用它对 `answers[]` 重放定生死（`advance`/`finish` 强制携带 `typed` 与服务端比对，杜绝客户端谎报），前端用同一份代码做预测表现——**同一答案序列在两端产出完全一致的 HP 轨迹**，这是防作弊与断线续 Run 一致性的基础，改动引擎逻辑必须两端同步验证。

### 数据模型要点（`db/schema.prisma`）

- `Word` / `WordSense`（义项，多义词逐义项独立例句）/ `WordPair`（易混词对，双向查询）/ `BankWord`（词书→单词，`stage` 分组）
- 双粒度 SRS：`UserWordProgress`（词级，管掌握度/错题本/生词本）与 `UserSenseProgress`（义项级，管下一次考哪个义项），字段都是 `reviewStage / nextReviewAt / ease`
- `LearningSession` / `LearningSessionItem` —— 传统"关卡"模式的会话与逐题记录
- `Run` / `RunItem` —— 生存模式：`Run` 是服务端权威状态机（`hp/maxHp/day/buffs/status` 等），`RunItem` 是逐题持久化记录，`answered=false` 的记录即"断点续 Run"的还原点；`Run` 同时充当历史最高纪录表（按 `(userId, stageId)` 取 `day` 最大值）
- 每个模型 `@@index` 都是为特定查询路径设计的（如 `Run` 的 `[userId, status]` 服务 `/runs/active`），新增查询前先看是否已有对应索引

### 后端模块划分（`apps/api/src/`）

按业务域一域一个 Nest module：`auth`（JWT access/refresh 轮换 + strengthen 强化）、`banks`（词书/阶段地图）、`questions`（服务端出题）、`sessions`（关卡会话结算）、`runs`（生存 Run 全生命周期）、`collections`（图鉴）、`materials`（材料+合成系统）、`stats`、`settings`。写接口一律挂 `JwtAuthGuard`，`sessions/:id` 与 `runs/:id` 系列接口都要校验资源归属当前用户。并发安全统一走"`status='active'` 守卫 + `updateMany` 计数校验 + 事务"的乐观锁模式（而非行锁），新增会修改 Run/Session 状态的接口要遵循同一模式。

### 前端结构（`apps/web/src/`）

`pages/` 路由级页面，`components/` 内混合渲染两套战斗表现：`BattleField.tsx`（Phaser，负责怪物/特效/连击视觉）与 `TypingCore.tsx`/`ChoiceCore.tsx`（DOM 打字/选择题输入），二者经 Zustand（`store/`）单向广播同步，Phaser 主循环内部禁止直接订阅 Zustand。`lib/survivalBattle.ts` 是前端对 `packages/shared/src/survival.ts` 引擎的调用封装，用于战斗中的客户端预测；`lib/api.ts` 是带 401 自动 refresh 重试的 API client；`lib/tts.ts` 是 TtsProvider 抽象（当前实现 Web Speech API，听写模式的可靠性依赖它）。

### 测试策略

- 纯函数模块（抽词比例、义项轮换、易混补抽、Boss 触发、buff 选池、生存引擎数值等）单测覆盖率是重点，改动前先看是否已有对应 `.spec.ts`
- 生存模式数值经过蒙特卡洛仿真标定（目标：中位存活 5–15 天），标定依据与结论记录在 `生存模式执行计划.md` §4.9；调整 `packages/shared/src/game.ts` 里的 `SURVIVAL` 数值表前应重新跑 `balance-sim.ts` 复核分布，不能只凭直觉改
- CI（`.github/workflows/ci.yml`）流程固定为 `pnpm install --frozen-lockfile` → `prisma generate` → `pnpm typecheck` → `pnpm build` → `pnpm test`，本地提交前建议按此顺序自查
