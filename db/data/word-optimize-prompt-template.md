# 单词数据优化 · 定时任务提示词模板

用途：给「单词之旅」词库做**周期性批量数据优化**。每次运行从考研词库（红宝书词书）随机抽 50 个单词，对每个词优化四个维度——**词义分布、熟词僻义、常用词组、记忆锚点**——并把结果回填数据库。适用于任务看板（task-board）的 cron 定时任务，也可人工手动跑一轮。

## 配套脚本（均以 `pnpm --filter @word-journey/db` 为前缀）

| 步骤 | 脚本 | 作用 |
| --- | --- | --- |
| 抽词 | `exec tsx pipeline/export-optimize-targets.ts` | 从红宝书词书随机抽 50 词 → `db/data/optimize-targets.json` |
| 回填 | `exec tsx pipeline/import-word-optimize.ts` | 读 `db/data/word-optimize.json` 回填 DB |

## 使用流程

1. 抽词：运行 `export-optimize-targets.ts`，得到 `db/data/optimize-targets.json`（含 `text/tier/senses`）。
2. 优化：把下面「提示词正文」+ 该 JSON 内容交给模型，得到优化结果 JSON。
3. 保存：把结果存为 `db/data/word-optimize.json`。
4. 回填：先 `--dry-run` 看匹配与增量情况，再正式跑 `import-word-optimize.ts`。

> 任务看板定时任务：把「提示词正文」作为任务描述，agent 会按步骤 1→4 自动完成一轮（agent 需能访问本仓库工作区与服务器数据库）。

## 提示词正文（复制下面这一段 + 附上 optimize-targets.json 的内容）

```
你是「单词之旅」的考研词库数据优化师。我会给你一份单词列表（JSON 数组，字段为
text/单词、tier/难度档位 I~IV、senses/现有义项，义项间用 ║ 分隔）。请对每个词按下面
四个维度做数据优化。所有判断一律以【考研英语（含英语一/二）大纲与真题】为准，不要
引入雅思/托福/GRE 等超纲偏义，也不要编造低频生僻义。

一、词义分布
1. 给出这个词在考研范围内「完整、准确」的义项列表，按考研真题中的使用频率从高到低排序。
2. 义项要覆盖主要词性；每个义项用最简洁的中文概括（一般 2~8 字，可带词性前缀如 n./vt./vi./adj./adv.）。
3. 合并明显重复的义项；若现有义项（senses 字段里）有遗漏或表述不准，在结果里补齐/修正。

二、熟词僻义
1. 重点识别并标出考研真题常考的「熟词僻义」——即该常见词在考研语境下的非常见/引申义项
   （例：address 处理解决、object 反对、appropriate 挪用、save 除…之外、sentence 判刑）。
2. 在义项列表里，对这类僻义加 rare:true，并用一句不超过 20 字的话注明它为什么是考研高频僻义（rareNote）。
3. 没有僻义的词就不标，不要硬凑。

三、常用词组
1. 给出该词在考研语境下的高频搭配/短语 2~5 个（例：address the issue 解决问题）。
2. 每个词组配一个简短中文释义；词组用「真实、能查到」的固定搭配，不要自造。
3. 没有常用词组的词可以给 1 个或省略（phrases 留空数组）。

四、记忆锚点
1. 一句话联想，中文为主，不超过 40 个汉字；能中英混排但英文要短。
2. 优先真实词根/前缀/后缀拆解（re-再 + vis 看 → revisit 重访）；无清晰词根时改用形近/谐音/意象联想，不得编造词源。
3. 联想要对得上实际释义，读完能马上想起意思；语气口语化，像学长学姐一句提示。
4. 避免粗俗、政治、宗教、地域歧视等冒犯内容，不引用真实人物/时事。

输出格式：只输出 JSON 数组，不要任何解释文字、不要 markdown 代码块围栏，每个元素严格为：
{
  "text": "<与输入完全一致的单词>",
  "senses": [ { "meaning": "<词性+中文释义>", "rare": false, "rareNote": "" }, ... ],
  "phrases": [ { "phrase": "<英文词组>", "meaning": "<中文释义>" }, ... ],
  "mnemonic": "<记忆锚点>"
}
- text 必须与输入原样一致（不改大小写/不加空格）。
- senses 数组必须「完整」——是优化后的全量义项（含原有义项 + 补充的僻义/遗漏义项），不是只列新增的。
- rare 只对熟词僻义为 true，普通义项一律 false。
- phrases 可为空数组 []。

以下是单词列表：
<把 optimize-targets.json 的内容粘贴在这里>
```

## 示例（判断模型输出质量）

输入：`{ "text": "address", "tier": "II", "senses": "n.地址,通信处,演说,称呼 ║ v.写姓名地址,演说,向…说话,称呼" }`

较好的输出：

```json
{
  "text": "address",
  "senses": [
    { "meaning": "n. 地址；网址", "rare": false, "rareNote": "" },
    { "meaning": "v. 演讲；向…致辞", "rare": false, "rareNote": "" },
    { "meaning": "v. 处理，解决；应对", "rare": true, "rareNote": "考研高频熟词僻义" }
  ],
  "phrases": [
    { "phrase": "address the issue", "meaning": "解决问题" },
    { "phrase": "deliver an address", "meaning": "发表演讲" }
  ],
  "mnemonic": "ad(向)+dress(穿衣) → 向…致辞；引申为「处理」问题"
}
```

较差的输出（不要）：

```json
{ "text": "address", "senses": [{ "meaning": "地址", "rare": false, "rareNote": "" }], "phrases": [], "mnemonic": "address 意思是地址" }
```
—— 义项漏了「处理/解决」这个考研僻义、词组缺失、记忆锚点没有联想抓手，等于没优化。

## 字段与回填约束（改模板/脚本前先看这里）

- 落点字段：义项 → `WordSense.meaning`（`@@unique([wordId, idx])`）；词组 → `Word.phrases Json`（本次新增）；记忆锚点 → `Word.mnemonic VarChar(300)`。
- **义项回填是「增量追加」而非全量重建**：只把结果里 DB 尚不存在的义项追加到该词末尾（保护 `UserSenseProgress` 的 `senseIdx` 关联与用户学习进度），不重排、不删除已有义项。
- 词组 / 记忆锚点按 `text` 精确匹配 `Word.text`（唯一索引）覆盖式更新，幂等，可反复重跑。
- 模型不得改写单词拼写/大小写，导入按 `text` 匹配，匹配不上的词会跳过并报告。
