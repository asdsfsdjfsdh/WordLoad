-- 回填：Boss 状态从 extra JSON 迁移到正式列（历史数据）
-- bossClearedCount 直接取自 extra.bossClearedCount（旧 settle 曾 +everBoss 双计数，extra 中存的是真实值）
-- 注意：布尔 JSON 需经 JSON_UNQUOTE 转字符串再比较，直接 JSON 比较会返回 'true'/'false' 字符串写布尔列报 1366
UPDATE `run`
SET
  `everBoss` = IF(JSON_UNQUOTE(JSON_EXTRACT(`extra`, '$.everBoss')) = 'true', 1, 0),
  `lastBossDay` = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(`extra`, '$.lastBossDay')) AS UNSIGNED), 0),
  `lastBossConsumed` = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(`extra`, '$.lastBossConsumed')) AS UNSIGNED), 0),
  `bossClearedCount` = COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(`extra`, '$.bossClearedCount')) AS UNSIGNED), 0);