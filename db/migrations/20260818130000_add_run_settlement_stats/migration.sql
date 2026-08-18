-- AlterTable: Run 结算落库评级/经验/金币（统计页口径与 LearningSession 对齐）
ALTER TABLE `Run` ADD COLUMN `rating` VARCHAR(4) NOT NULL DEFAULT 'C',
  ADD COLUMN `xpEarned` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `coinsEarned` INTEGER NOT NULL DEFAULT 0;
