-- AlterTable
ALTER TABLE `UserWordProgress`
  ADD COLUMN `srsHistory` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  ADD COLUMN `masteredAt` DATETIME(3) NULL;
