# 记忆锚点生成提示词模板

用途：给「单词之旅」的单词批量生成**记忆锚点**（一句话联想/词根提示），在拼写巩固阶段（战斗内答错重写 / 预习闪卡）展示，帮助建立比"死记硬背"更深的编码。这一步**不在项目内自动跑 AI**，而是把生成动作交给你自己选的模型完成，再用导入脚本回填。

## 使用流程

1. 导出待生成清单（找出 `mnemonic` 为空的词）：
   ```bash
   pnpm --filter @word-journey/db exec tsx pipeline/export-mnemonic-targets.ts --limit=200
   ```
   生成 `db/data/mnemonic-targets.json`，形如：
   ```json
   [{ "text": "abandon", "tier": "II", "meaning": "v. 放弃，抛弃" }, ...]
   ```
2. 把下面的提示词 + 该 JSON 文件内容一起交给你要用的模型（人工复制粘贴，不限定具体模型）。
3. 把模型返回的 JSON 保存为 `db/data/mnemonics.json`。
4. 先 dry-run 检查匹配情况，再正式回填：
   ```bash
   pnpm --filter @word-journey/db exec tsx pipeline/import-mnemonics.ts --dry-run
   pnpm --filter @word-journey/db exec tsx pipeline/import-mnemonics.ts
   ```
5. 抽查几十条人工过一遍（尤其是词根类比是否瞎编、比喻是否别扭），不满意的词条改完直接重新跑 4 覆盖即可（`updateMany` 按 `text` 覆盖，幂等）。

## 提示词正文（复制下面这一段 + 附上 JSON 文件内容）

```
你是一名面向中国考研英语 / CET6 学习者的词汇记忆教练。我会给你一份单词列表（JSON 数组，字段为
text/单词、tier/难度档位 I~IV、meaning/中文释义），请为每个词生成一条「记忆锚点」。

记忆锚点要求：
1. 一句话，中文为主，不超过 40 个汉字（含标点）；能中英混排但英文部分要短。
2. 优先用真实、准确的词根/前缀/后缀拆解（例如 re-(再次) + vis(看) + -it → revisit 重新看=重访）；
   如果这个词没有清晰词根可拆，改用词形联想（形近词对比）或谐音/意象联想，但不要编造不存在的词源。
3. 联想要贴近这个词的实际释义，读完能马上想起意思，不要只是好玩但对不上号。
4. 语气简洁、口语化，像学长学姐随口一句提示，不要写成教科书式的词源考据。
5. 避免任何粗俗、政治、宗教、地域歧视或其他冒犯性内容；避免引用真实人物/时事。
6. tier 越高（III/IV，超纲/长难词）可以适当更依赖词根拆解，因为这类词孤立记忆成本更高；
   tier 越低（I/II，基础高频词）可以更简短，甚至一个联想画面即可。

输出格式：只输出 JSON 数组，不要任何解释文字、不要 markdown 代码块围栏，每个元素严格为：
{ "text": "<与输入完全一致的单词>", "mnemonic": "<记忆锚点>" }
数组顺序和输入保持一致，text 字段必须和输入原样一致（不要改大小写/加空格）。

以下是单词列表：
<把 mnemonic-targets.json 的内容粘贴在这里>
```

## 示例（供你判断模型输出质量是否达标）

输入：`{ "text": "abandon", "tier": "II", "meaning": "v. 放弃，抛弃" }`

较好的输出：
```json
{ "text": "abandon", "mnemonic": "a+bandon(禁令) → 被禁令关起来只能放弃" }
```

较差的输出（不要）：
```json
{ "text": "abandon", "mnemonic": "abandon是一个常用词，意思是放弃" }
```
—— 没有任何联想抓手，等于没写。

## 字段约束提醒（与 schema/导入脚本对齐，改模板前先看这里）

- 数据库字段：`Word.mnemonic String? @db.VarChar(300)`（`db/schema.prisma`），导入脚本会自动截断到 300 字符，但提示词里限定 40 汉字是为了保证"一句话"的可读性，不是数据库限制。
- 导入按 `text` 精确匹配 `Word.text`（唯一索引），模型不得改写单词拼写/大小写。
- 覆盖式导入：同一个词再次导入会覆盖旧 mnemonic，方便迭代重跑，不需要先清空。
