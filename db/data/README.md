# 词库源数据

本目录存放从公开源获取的原始词库 JSON/SQL 文件，**体积较大不入 git**。

当前数据来源：<https://github.com/zhenghaoyang24/english-vocabulary>
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
