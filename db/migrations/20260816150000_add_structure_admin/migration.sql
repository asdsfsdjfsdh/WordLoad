-- AlterTable
ALTER TABLE `readingsentence` ADD COLUMN `structure` JSON NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false;

