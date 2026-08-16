-- 增加：单词记忆锚点（词根/联想一句话，可选字段，离线批量生成后导入）
ALTER TABLE `Word` ADD COLUMN `mnemonic` VARCHAR(300) NULL;
