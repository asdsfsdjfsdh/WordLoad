-- AlterTable
ALTER TABLE `userwordprogress` ADD COLUMN `wrongStreak` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `skipped` BOOLEAN NOT NULL DEFAULT false;
