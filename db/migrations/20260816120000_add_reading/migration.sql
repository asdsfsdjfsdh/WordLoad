-- CreateTable
CREATE TABLE `ReadingPaper` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `examName` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ReadingPaper_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingPassage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paperId` INTEGER NOT NULL,
    `code` VARCHAR(1) NOT NULL,
    `title` VARCHAR(32) NOT NULL,
    `subtitle` VARCHAR(128) NULL,
    `questionsStart` INTEGER NOT NULL DEFAULT 21,
    `order` INTEGER NOT NULL DEFAULT 0,
    `content` TEXT NOT NULL,
    `translation` TEXT NOT NULL,

    INDEX `ReadingPassage_paperId_idx`(`paperId`),
    UNIQUE INDEX `ReadingPassage_paperId_code_key`(`paperId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingSentence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `passageId` INTEGER NOT NULL,
    `para` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `en` TEXT NOT NULL,
    `zh` TEXT NOT NULL,

    INDEX `ReadingSentence_passageId_idx`(`passageId`),
    UNIQUE INDEX `ReadingSentence_passageId_seq_key`(`passageId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingQuestion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `passageId` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `stem` TEXT NOT NULL,
    `options` JSON NOT NULL,
    `answer` VARCHAR(1) NOT NULL,
    `analysis` TEXT NOT NULL,

    INDEX `ReadingQuestion_passageId_idx`(`passageId`),
    UNIQUE INDEX `ReadingQuestion_passageId_seq_key`(`passageId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingGlossary` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `passageId` INTEGER NOT NULL,
    `word` VARCHAR(64) NOT NULL,
    `meaning` TEXT NOT NULL,
    `wordId` VARCHAR(191) NULL,

    INDEX `ReadingGlossary_passageId_idx`(`passageId`),
    UNIQUE INDEX `ReadingGlossary_passageId_word_key`(`passageId`, `word`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingProgress` (
    `userId` INTEGER NOT NULL,
    `passageId` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'not-started',
    `bestScore` INTEGER NOT NULL DEFAULT 0,
    `totalQuestions` INTEGER NOT NULL DEFAULT 0,
    `correctCount` INTEGER NOT NULL DEFAULT 0,
    `currentSentence` INTEGER NOT NULL DEFAULT 0,
    `lastReadAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReadingProgress_passageId_idx`(`passageId`),
    PRIMARY KEY (`userId`, `passageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingAnswer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `passageId` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `choice` VARCHAR(1) NOT NULL,
    `correct` BOOLEAN NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReadingAnswer_userId_passageId_idx`(`userId`, `passageId`),
    INDEX `ReadingAnswer_passageId_idx`(`passageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReadingSavedWord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `passageId` INTEGER NOT NULL,
    `word` VARCHAR(64) NOT NULL,
    `meaning` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReadingSavedWord_userId_idx`(`userId`),
    UNIQUE INDEX `ReadingSavedWord_userId_passageId_word_key`(`userId`, `passageId`, `word`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReadingPassage` ADD CONSTRAINT `ReadingPassage_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `ReadingPaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingSentence` ADD CONSTRAINT `ReadingSentence_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingQuestion` ADD CONSTRAINT `ReadingQuestion_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingGlossary` ADD CONSTRAINT `ReadingGlossary_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingGlossary` ADD CONSTRAINT `ReadingGlossary_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingProgress` ADD CONSTRAINT `ReadingProgress_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingProgress` ADD CONSTRAINT `ReadingProgress_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingAnswer` ADD CONSTRAINT `ReadingAnswer_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingAnswer` ADD CONSTRAINT `ReadingAnswer_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingSavedWord` ADD CONSTRAINT `ReadingSavedWord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReadingSavedWord` ADD CONSTRAINT `ReadingSavedWord_passageId_fkey` FOREIGN KEY (`passageId`) REFERENCES `ReadingPassage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

