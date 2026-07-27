-- 1. Column
ALTER TABLE public.workstream_cards
  ADD COLUMN IF NOT EXISTS task_code text;

-- 2. Sequence for numeric portion (never reused)
CREATE SEQUENCE IF NOT EXISTS public.workstream_card_code_seq
  AS bigint START 1 INCREMENT 1;

-- 3. Assignment trigger (BEFORE INSERT)
CREATE OR REPLACE FUNCTION public.workstream_cards_assign_task_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.task_code IS NULL OR NEW.task_code = '' THEN
    NEW.task_code := 'WS-' || LPAD(nextval('public.workstream_card_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workstream_cards_assign_task_code ON public.workstream_cards;
CREATE TRIGGER trg_workstream_cards_assign_task_code
BEFORE INSERT ON public.workstream_cards
FOR EACH ROW EXECUTE FUNCTION public.workstream_cards_assign_task_code();

-- 4. Backfill existing rows in creation order (must happen BEFORE the lock trigger)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
    FROM public.workstream_cards
    WHERE task_code IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.workstream_cards
       SET task_code = 'WS-' || LPAD(nextval('public.workstream_card_code_seq')::text, 4, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- 5. Immutability trigger (BEFORE UPDATE) — added after backfill
CREATE OR REPLACE FUNCTION public.workstream_cards_lock_task_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.task_code IS DISTINCT FROM OLD.task_code THEN
    RAISE EXCEPTION 'task_code is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workstream_cards_lock_task_code ON public.workstream_cards;
CREATE TRIGGER trg_workstream_cards_lock_task_code
BEFORE UPDATE ON public.workstream_cards
FOR EACH ROW EXECUTE FUNCTION public.workstream_cards_lock_task_code();

-- 6. Enforce NOT NULL + UNIQUE + index for fast lookup
ALTER TABLE public.workstream_cards
  ALTER COLUMN task_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workstream_cards_task_code_key'
  ) THEN
    ALTER TABLE public.workstream_cards
      ADD CONSTRAINT workstream_cards_task_code_key UNIQUE (task_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS workstream_cards_task_code_idx
  ON public.workstream_cards (task_code);