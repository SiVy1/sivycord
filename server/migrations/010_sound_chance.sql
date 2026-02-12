-- Add sound_chance to server_settings
ALTER TABLE server_settings ADD COLUMN sound_chance INTEGER NOT NULL DEFAULT 100;
