ALTER TABLE public.chat_messages
ADD COLUMN user_id uuid;

CREATE INDEX idx_chat_messages_user_id ON public.chat_messages(user_id);