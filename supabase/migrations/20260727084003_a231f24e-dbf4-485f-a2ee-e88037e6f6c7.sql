ALTER TABLE public.workstream_cards
  ALTER COLUMN task_code
  SET DEFAULT ('WS-' || LPAD(nextval('public.workstream_card_code_seq')::text, 4, '0'));