-- Add avatar_url to messages table
ALTER TABLE messages ADD COLUMN avatar_url TEXT DEFAULT NULL;
