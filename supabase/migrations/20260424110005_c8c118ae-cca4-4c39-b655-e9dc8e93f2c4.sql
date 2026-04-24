ALTER TABLE public.slack_connections
ADD COLUMN IF NOT EXISTS user_access_token TEXT,
ADD COLUMN IF NOT EXISTS user_scope TEXT,
ADD COLUMN IF NOT EXISTS user_token_type TEXT;