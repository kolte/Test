-- Adds a platform column to Device, defaulted to "windows".

ALTER TABLE "Device"
  ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'windows';
