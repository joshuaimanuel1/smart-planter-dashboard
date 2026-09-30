-- CreateTable
CREATE TABLE `TelemetryLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deviceId` VARCHAR(64) NOT NULL DEFAULT 'esp32-planter-01',
    `temperature` DOUBLE NOT NULL,
    `humidity` DOUBLE NOT NULL,
    `soilMoisture` INTEGER NOT NULL,
    `soilStatus` VARCHAR(16) NOT NULL,
    `ldrLight` INTEGER NOT NULL,
    `uvIndex` DOUBLE NOT NULL,
    `pumpOn` BOOLEAN NOT NULL,
    `growlightOn` BOOLEAN NOT NULL,
    `mode` VARCHAR(16) NOT NULL DEFAULT 'AUTO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TelemetryLog_deviceId_createdAt_idx`(`deviceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceState` (
    `deviceId` VARCHAR(64) NOT NULL DEFAULT 'esp32-planter-01',
    `mode` VARCHAR(16) NOT NULL DEFAULT 'AUTO',
    `pumpOn` BOOLEAN NOT NULL DEFAULT false,
    `growlightOn` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`deviceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
