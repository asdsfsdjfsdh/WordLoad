-- CreateTable
CREATE TABLE `Run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `bankId` INTEGER NOT NULL,
    `stageId` INTEGER NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'zh2en',
    `day` INTEGER NOT NULL DEFAULT 1,
    `hp` INTEGER NOT NULL,
    `maxHp` INTEGER NOT NULL,
    `buffs` JSON NOT NULL,
    `lastInjectDay` INTEGER NOT NULL DEFAULT 0,
    `surrendered` BOOLEAN NOT NULL DEFAULT false,
    `recordBroken` BOOLEAN NOT NULL DEFAULT false,
    `extra` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Run_userId_status_idx`(`userId`, `status`),
    INDEX `Run_userId_stageId_idx`(`userId`, `stageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RunItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `wordId` VARCHAR(191) NOT NULL,
    `senseIdx` INTEGER NOT NULL DEFAULT 0,
    `type` VARCHAR(191) NOT NULL,
    `answered` BOOLEAN NOT NULL DEFAULT false,
    `correct` BOOLEAN NULL,
    `elapsedMs` INTEGER NOT NULL DEFAULT 0,

    INDEX `RunItem_runId_idx`(`runId`),
    UNIQUE INDEX `RunItem_runId_seq_key`(`runId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Run` ADD CONSTRAINT `Run_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Run` ADD CONSTRAINT `Run_bankId_fkey` FOREIGN KEY (`bankId`) REFERENCES `WordBank`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RunItem` ADD CONSTRAINT `RunItem_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `Run`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RunItem` ADD CONSTRAINT `RunItem_wordId_fkey` FOREIGN KEY (`wordId`) REFERENCES `Word`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
