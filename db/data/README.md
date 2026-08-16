# 词库源数据

本目录存放从公开源获取的原始词库 JSON/SQL 文件，**体积较大不入 git**。

## 考研词汇便携版（kaoyan_engl1）

数据来源：<https://github.com/zhenghaoyang24/english-vocabulary>
（考研词汇便携版，含双音标/中文释义/例句）

重新获取：

```powershell
git clone --depth 1 https://github.com/zhenghaoyang24/english-vocabulary.git $env:TEMP\opencode\ev
Copy-Item "$env:TEMP\opencode\ev\tb_vocabulary.json","$env:TEMP\opencode\ev\tb_voc_book.json","$env:TEMP\opencode\ev\tb_voc_examples.json" .
```

生成后运行导入管线：

```powershell
pnpm --filter @word-journey/db pipeline:import -- --force
pnpm --filter @word-journey/db pipeline:check
```

## 红宝书·英语一（hongbaoshu_engl1）

词表 + 结构（必考词 Unit 1-26 / 基础词 Unit 1-31 / 超纲词 A-Z）：
<https://github.com/busiyiworld/maimemo-export> 的 `exported/list/2025考研英语词汇红宝书.txt`

释义兜底：<https://github.com/3056810551/2027-kaoyan-english-redbook-json> 的 `words.json`

音标兜底：<https://github.com/skywind3000/ECDICT> 的 `ecdict.csv`（预处理后仅保留红宝书词的音标，见 `hongbaoshu_phonetics.json`）

导入管线（复用 tb_vocabulary/tb_voc_examples 富化音标/释义/例句，stage 复合编码：必考=1xx、基础=2xx、超纲=3xx）：

```powershell
pnpm --filter @word-journey/db pipeline:import-hongbaoshu -- --force
pnpm --filter @word-journey/db pipeline:pairs -- --bank-code=hongbaoshu_engl1
```

## 记忆锚点（mnemonic）

单词的"记忆锚点"（词根/联想一句话）不在项目内跑 AI 生成，走「导出清单 → 交给外部模型 → 回填」的离线流程，
提示词模板与完整步骤见 [`mnemonic-prompt-template.md`](./mnemonic-prompt-template.md)。

