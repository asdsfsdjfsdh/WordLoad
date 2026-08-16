-- 增加：学习会话 Boss 段血量（enterBoss 落库，submit 服务端权威判定 bossCleared，杜绝客户端宣称）
ALTER TABLE `LearningSession` ADD COLUMN `bossHp` INTEGER NOT NULL DEFAULT 0;
