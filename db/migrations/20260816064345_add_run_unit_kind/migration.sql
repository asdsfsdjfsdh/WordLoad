-- AlterTable: Run 支持红宝书 Unit 肉鸽（kind=unit 缺省）+ 通关标记 + Final Boss 随机血量
ALTER TABLE `run` ADD COLUMN `cleared` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `finalBossHp` INTEGER NULL,
    ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'unit';

-- DropIndex: 旧 [userId,status] 索引升级为 [userId,kind,status]（按 kind 查活跃 Run）
DROP INDEX `Run_userId_status_idx` ON `run`;

-- CreateIndex
CREATE INDEX `Run_userId_kind_status_idx` ON `Run`(`userId`, `kind`, `status`);
