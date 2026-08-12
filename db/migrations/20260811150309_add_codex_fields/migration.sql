-- AlterTable
ALTER TABLE `userwordprogress` ADD COLUMN `firstEncounteredAt` DATETIME(3) NULL,
    ADD COLUMN `lastEncounteredAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `LearningSession_userId_createdAt_idx` ON `LearningSession`(`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `LearningSession_userId_bankId_result_idx` ON `LearningSession`(`userId`, `bankId`, `result`);

-- CreateIndex
CREATE INDEX `UserSenseProgress_userId_nextReviewAt_idx` ON `UserSenseProgress`(`userId`, `nextReviewAt`);

-- CreateIndex
CREATE INDEX `UserWordProgress_userId_nextReviewAt_idx` ON `UserWordProgress`(`userId`, `nextReviewAt`);

-- CreateIndex
CREATE INDEX `UserWordProgress_nextReviewAt_idx` ON `UserWordProgress`(`nextReviewAt`);

-- CreateIndex
CREATE INDEX `Word_difficultyScore_idx` ON `Word`(`difficultyScore`);

-- CreateIndex
CREATE INDEX `Word_tier_idx` ON `Word`(`tier`);

-- RenameIndex
ALTER TABLE `learningsessionitem` RENAME INDEX `LearningSessionItem_sessionId_fkey` TO `LearningSessionItem_sessionId_idx`;

-- RenameIndex
ALTER TABLE `learningsessionitem` RENAME INDEX `LearningSessionItem_wordId_fkey` TO `LearningSessionItem_wordId_idx`;
