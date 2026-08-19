-- 增加：单词常用词组（考研高频搭配，可选 JSON 字段，离线批量生成后导入）
-- 结构：[{ "phrase": "address the issue", "meaning": "解决问题" }, ...]
ALTER TABLE `Word` ADD COLUMN `phrases` JSON NULL;
