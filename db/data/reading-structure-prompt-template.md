# 考研英语一真题阅读 · 长难句结构标注提示词

用法：运行 `pnpm --filter @word-journey/db pipeline:structure-export` 生成 `db/data/reading/structures-export.json`
（待标注句子清单），把其中的 JSON 数组连同下面的提示词一起发给外部模型，模型返回一个 JSON 对象
（key 为句子的 `key`），保存为 `db/data/reading/structures.json`，再运行
`pnpm --filter @word-journey/db pipeline:structure-import` 校验并回填。

---

## 提示词正文（复制给模型）

你是英语语法分析专家，为考研英语一阅读真题做长难句结构标注。下面给你一批句子，请对每个句子
输出结构标注，**只输出一个 JSON 对象，不要任何额外文字**。

### 输出格式

```json
{
  "<key>": {
    "clauses": [
      { "role": "main", "label": "主句", "text": "<原文片段，必须是原文子串>" },
      { "role": "adj", "label": "定语从句", "text": "<原文片段>" }
    ],
    "main": { "subject": "<主干主语>", "predicate": "<主干谓语>", "object": "<主干宾语，可省略>" }
  }
}
```

- `key`：必须原样使用输入清单里的 `key` 字段（形如 `2023:A:0`）。
- `clauses`：把整句拆成若干片段（尽可能覆盖全句），每个片段指定一种角色。
- `main`：句子主干（主谓宾骨架），`subject`/`predicate` 必填，`object` 可省略；主干文字可摘自原文、
  也可做最小化概括，不要求是原文子串。

### 角色定义（role 只能取以下值）

| role | 含义 | 说明 |
|---|---|---|
| `main` | 主句 | 主干所在主句片段 |
| `noun` | 名词性从句 | that/what/whether/how 等引导的主/宾/表语从句 |
| `adj` | 定语从句 | which/that/who/whose/whom/where/when 引导，修饰名词 |
| `adv` | 状语从句 | because/although/while/since/if/when/where 等引导 |
| `participle` | 分词短语 | doing/done 作状语或后置定语 |
| `prep` | 介词短语 | with/in/for/among 等介词短语 |
| `infinitive` | 不定式 | to do 结构 |
| `appositive` | 同位语 | 解释说明前文的名词/名词短语 |
| `coordinate` | 并列结构 | and/or/but 连接的并列成分 |
| `other` | 其他成分 | 不便归入以上类型时 |

### 要求

1. 每个 `clauses[].text` 必须是**原句原文的子串**（允许因排版缺空格，但不能改写、增删词）。
2. 同一段原文如被多层嵌套，`clauses` 里可同时列出（外层与内层），渲染时按最具体片段着色。
3. 简单句：`clauses` 可只给 1 个 `main` 片段，`main` 给出主干。
4. 引号内的人名机构名视为普通名词成分，归入所在片段即可。

### 示例

输入句子：
```json
{ "key": "2023:A:3", "seq": 3, "en": "Most scientists and experts sharply dispute Hardy's views.", "zh": "大多数科学家和专家强烈反对哈迪的观点。" }
```

正确输出：
```json
{
  "2023:A:3": {
    "clauses": [
      { "role": "main", "label": "主句", "text": "Most scientists and experts sharply dispute Hardy's views." }
    ],
    "main": { "subject": "Most scientists and experts", "predicate": "dispute", "object": "Hardy's views" }
  }
}
```

### 待标注句子

```json
<这里粘贴 structures-export.json 的内容>
```
