# 考研英语一真题阅读 · 句子知识点标注提示词

用法：运行 `pnpm --filter @word-journey/db pipeline:knowledge-export` 生成 `db/data/reading/knowledge-export.json`
（按篇分组的待标注清单），把其中的 JSON 连同下面的提示词一起发给外部模型，模型返回一个 JSON 对象
（key 为句子的 `key`），保存为 `db/data/reading/knowledge.json`，再运行
`pnpm --filter @word-journey/db pipeline:knowledge-import` 校验并回填。

---

## 提示词正文（复制给模型）

你是考研英语阅卷与精读专家，为英语一真题阅读做**逐句精读知识点标注**。下面给你若干篇
文章（含全文与待标注句子），请针对每个句子输出真正值得精读时掌握的要点：**重要的语法点、
固定句型、核心单词、词组搭配**。

要求这些要点是**实际理解这篇文章真正用得上的知识点**，而不是把句子结构机械罗列一遍。
**只输出一个 JSON 对象，不要任何额外文字。**

### 输出格式

```json
{
  "<key>": {
    "grammar": [
      { "title": "<语法/句型名称，如 让步状语从句 / not only...but also / 定语从句中的省略>", "text": "<结合本句实际讲解：这个语法点出现在句子的哪里、为什么重要、怎么理解>" }
    ],
    "words": [
      { "word": "<单词>", "meaning": "<在本句中的含义>", "note": "<补充讲解（可省略）：词性/词根/易错点/与中文对应> " }
    ],
    "phrases": [
      { "text": "<词组>", "meaning": "<含义>", "note": "<补充讲解（可省略）>" }
    ]
  }
}
```

### 要求

1. `key`：必须原样使用输入里的 `key` 字段（形如 `2023:A:0`）。
2. **宁缺毋滥**：只写真正值得精读掌握的点。语法要点 0-4 条、单词 0-6 个、词组 0-4 个。
   没有值得写的类目就省略该字段或留空数组。简单句可以只给 1 条语法要点甚至全部为空。
3. **禁止机械罗列结构名词**：不要写"主句：全句主干核心"这类空话，也不要逐条照抄结构标注里的
   从句角色。每个语法要点必须结合本句**实际文字**讲清：这个语法现象出现在哪部分、为什么
   会造成理解难点、该如何拆解翻译。
4. `grammar[].text` 要具体：说明该语法点在原句中的位置（可引用原文片段）、承担的作用、
   以及阅读时应如何断句/调整语序。
5. `words` 只挑本句最值得学的词：生词、高频考词、熟词僻义、易混词、或对理解句子很关键的词。
   `meaning` 用本句语境义，`note` 可补充词性 / 词根 / 一词多义提示。
6. `phrases` 挑真正有学习价值的固定搭配 / 短语动词，不是本句出现过的所有介词组合。
7. 引用原文片段时保持原句文字，不要改写。

### 示例

输入句子（附全文语境）：
```json
{ "key": "2023:A:3", "seq": 3, "en": "Most scientists and experts sharply dispute Hardy's views.", "zh": "大多数科学家和专家强烈反对哈迪的观点。" }
```

正确输出：
```json
{
  "2023:A:3": {
    "grammar": [
      { "title": "主谓宾简单句 + 副词修饰", "text": "主干为 Most scientists and experts dispute Hardy's views，sharply 作状语修饰 dispute，表示反对程度之强烈。阅读时先抓主谓宾再吸收副词程度。" }
    ],
    "words": [
      { "word": "sharply", "meaning": "强烈地、激烈地", "note": "副词；此处修饰 dispute（反对），表态度激烈，注意不是'尖锐地'的直译。" },
      { "word": "dispute", "meaning": "v. 反驳、反对", "note": "高频考词，与 argue 近义；名词义为'争论、争端'。" }
    ],
    "phrases": [
      { "text": "dispute one's views", "meaning": "反对某人的观点", "note": "动宾搭配，注意 views 复数表'观点、看法'。" }
    ]
  }
}
```

### 待标注数据

```json
<这里粘贴 knowledge-export.json 的内容>
```