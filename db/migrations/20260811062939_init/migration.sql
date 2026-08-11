-- CreateTable
CREATE TABLE `WordBank` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WordBank_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Word` (
    `id` VARCHAR(191) NOT NULL,
    `text` VARCHAR(64) NOT NULL,
    `phoneticAm` VARCHAR(128) NULL,
    `phoneticEn` VARCHAR(128) NULL,
    `difficultyScore` DOUBLE NOT NULL,
    `tier` VARCHAR(8) NOT NULL,
    `difficultyDims` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Word_text_key`(`text`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WordSense` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wordId` VARCHAR(191) NOT NULL,
    `idx` INTEGER NOT NULL,
    `meaning` TEXT NOT NULL,
    `example` TEXT NOT NULL,

    UNIQUE INDEX `WordSense_wordId_idx_key`(`wordId`, `idx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WordPair` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `wordAId` VARCHAR(191) NOT NULL,
    `wordBId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `note` VARCHAR(255) NOT NULL,

    UNIQUE INDEX `WordPair_wordAId_wordBId_key`(`wordAId`, `wordBId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankWord` (
    `bankId` INTEGER NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `stage` INTEGER NOT NULL,

    INDEX `BankWord_bankId_stage_idx`(`bankId`, `stage`),
    PRIMARY KEY (`bankId`, `wordId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(32) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserCharacter` (
    `userId` INTEGER NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `exp` INTEGER NOT NULL DEFAULT 0,
    `hpLv` INTEGER NOT NULL DEFAULT 1,
    `atkLv` INTEGER NOT NULL DEFAULT 1,
    `defLv` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserWordProgress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `stage` INTEGER NOT NULL DEFAULT 1,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `wrongCount` INTEGER NOT NULL DEFAULT 0,
    `inWrongBook` BOOLEAN NOT NULL DEFAULT false,
    `inVocabBook` BOOLEAN NOT NULL DEFAULT false,
    `mastery` INTEGER NOT NULL DEFAULT 0,
    `reviewStage` INTEGER NOT NULL DEFAULT 0,
    `nextReviewAt` DATETIME(3) NULL,
    `ease` DOUBLE NOT NULL DEFAULT 2.5,

    UNIQUE INDEX `UserWordProgress_userId_wordId_key`(`userId`, `wordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSenseProgress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `senseIdx` INTEGER NOT NULL,
    `reviewStage` INTEGER NOT NULL DEFAULT 0,
    `nextReviewAt` DATETIME(3) NULL,
    `ease` DOUBLE NOT NULL DEFAULT 2.5,
    `correctCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `UserSenseProgress_userId_wordId_senseIdx_key`(`userId`, `wordId`, `senseIdx`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Material` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `tier` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,

    UNIQUE INDEX `Material_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserMaterial` (
    `userId` INTEGER NOT NULL,
    `materialId` INTEGER NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`, `materialId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `bankId` INTEGER NOT NULL,
    `stageId` INTEGER NOT NULL,
    `mode` VARCHAR(16) NOT NULL,
    `result` BOOLEAN NOT NULL,
    `monstersCleared` INTEGER NOT NULL DEFAULT 0,
    `bossCleared` BOOLEAN NOT NULL DEFAULT false,
    `damageTaken` INTEGER NOT NULL DEFAULT 0,
    `stunCount` INTEGER NOT NULL DEFAULT 0,
    `maxCombo` INTEGER NOT NULL DEFAULT 0,
    `rating` VARCHAR(4) NOT NULL,
    `xpEarned` INTEGER NOT NULL DEFAULT 0,
    `coinsEarned` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LearningSessionItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `senseIdx` INTEGER NOT NULL DEFAULT 0,
    `type` VARCHAR(16) NOT NULL,
    `answered` BOOLEAN NOT NULL DEFAULT false,
    `correct` BOOLEAN NULL,
    `elapsedMs` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WordSense` ADD CONSTRAINT `WordSense_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WordPair` ADD CONSTRAINT `WordPair_wordAId_fkey` FOREIGN KEY (`wordAId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WordPair` ADD CONSTRAINT `WordPair_wordBId_fkey` FOREIGN KEY (`wordBId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankWord` ADD CONSTRAINT `BankWord_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `WordBank`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankWord` ADD CONSTRAINT `BankWord_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserCharacter` ADD CONSTRAINT `UserCharacter_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserWordProgress` ADD CONSTRAINT `UserWordProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserWordProgress` ADD CONSTRAINT `UserWordProgress_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSenseProgress` ADD CONSTRAINT `UserSenseProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSenseProgress` ADD CONSTRAINT `UserSenseProgress_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMaterial` ADD CONSTRAINT `UserMaterial_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserMaterial` ADD CONSTRAINT `UserMaterial_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `Material`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningSession` ADD CONSTRAINT `LearningSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningSession` ADD CONSTRAINT `LearningSession_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `WordBank`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningSessionItem` ADD CONSTRAINT `LearningSessionItem_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `LearningSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LearningSessionItem` ADD CONSTRAINT `LearningSessionItem_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
