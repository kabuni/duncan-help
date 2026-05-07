-- Add parent_task_id for one-level subtasks
ALTER TABLE public.workstream_tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.workstream_tasks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_workstream_tasks_parent ON public.workstream_tasks(parent_task_id);

-- Enforce single-level nesting: a subtask cannot itself be a parent.
CREATE OR REPLACE FUNCTION public.workstream_tasks_enforce_single_level()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.workstream_tasks
      WHERE id = NEW.parent_task_id AND parent_task_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Subtasks cannot have their own subtasks (single-level nesting only)';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.workstream_tasks
      WHERE parent_task_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot set parent on a task that already has subtasks';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workstream_tasks_single_level ON public.workstream_tasks;
CREATE TRIGGER trg_workstream_tasks_single_level
BEFORE INSERT OR UPDATE OF parent_task_id ON public.workstream_tasks
FOR EACH ROW EXECUTE FUNCTION public.workstream_tasks_enforce_single_level();

-- Auto roll-up: when a subtask changes, sync parent.completed.
CREATE OR REPLACE FUNCTION public.workstream_tasks_rollup_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent uuid;
  v_total int;
  v_done int;
BEGIN
  v_parent := COALESCE(NEW.parent_task_id, OLD.parent_task_id);
  IF v_parent IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE completed)
    INTO v_total, v_done
    FROM public.workstream_tasks
   WHERE parent_task_id = v_parent;

  IF v_total > 0 AND v_done = v_total THEN
    UPDATE public.workstream_tasks
       SET completed = true,
           status = 'done',
           updated_at = now()
     WHERE id = v_parent AND completed = false;
  ELSE
    UPDATE public.workstream_tasks
       SET completed = false,
           status = CASE WHEN status = 'done' THEN 'green' ELSE status END,
           updated_at = now()
     WHERE id = v_parent AND completed = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workstream_tasks_rollup ON public.workstream_tasks;
CREATE TRIGGER trg_workstream_tasks_rollup
AFTER INSERT OR UPDATE OF completed OR DELETE ON public.workstream_tasks
FOR EACH ROW EXECUTE FUNCTION public.workstream_tasks_rollup_parent();

-- Cascade parent completion to children.
CREATE OR REPLACE FUNCTION public.workstream_tasks_cascade_to_children()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    RETURN NEW; -- only run on parent rows
  END IF;
  IF NEW.completed IS DISTINCT FROM OLD.completed THEN
    UPDATE public.workstream_tasks
       SET completed = NEW.completed,
           status = CASE
             WHEN NEW.completed THEN 'done'
             WHEN status = 'done' THEN 'green'
             ELSE status
           END,
           updated_at = now()
     WHERE parent_task_id = NEW.id
       AND completed IS DISTINCT FROM NEW.completed;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workstream_tasks_cascade ON public.workstream_tasks;
CREATE TRIGGER trg_workstream_tasks_cascade
AFTER UPDATE OF completed ON public.workstream_tasks
FOR EACH ROW EXECUTE FUNCTION public.workstream_tasks_cascade_to_children();