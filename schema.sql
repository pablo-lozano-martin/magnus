DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;

CREATE TABLE conversations (
    id TEXT PRIMARY KEY, -- UUID
    title TEXT NOT NULL,
    icon TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Will be updated manually in app logic
    is_pinned INTEGER DEFAULT 0 -- 0 for false, 1 for true
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY, -- UUID
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL CHECK(sender_type IN ('human', 'ai')),
    content TEXT NOT NULL,
    sequence INTEGER NOT NULL, -- Order of message in the conversation
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
);

-- Optional: Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sequence ON messages (conversation_id, sequence);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations (updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_is_pinned ON conversations (is_pinned); -- Index for pinned status
