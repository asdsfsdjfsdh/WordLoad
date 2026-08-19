-- CreateTable
CREATE TABLE `Feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `content` VARCHAR(2000) NOT NULL,
    `contact` VARCHAR(128) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `reply` VARCHAR(2000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `repliedAt` DATETIME(3) NULL,

    INDEX `Feedback_userId_idx`(`userId`),
    INDEX `Feedback_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Feedback` ADD CONSTRAINT `Feedback_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
