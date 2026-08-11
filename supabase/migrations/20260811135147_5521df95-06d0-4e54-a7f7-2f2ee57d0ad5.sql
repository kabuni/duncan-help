CREATE TABLE public.todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  created_by uuid NOT NULL,
  title text NOT NULL,
  notes text,
  due_date date,
  priority text NOT NULL DEFAULT 'medium',
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  source_type text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_todos_user_id ON public.todos(user_id) WHERE completed = false;
CREATE INDEX idx_todos_created_by ON public.todos(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.todos TO authenticated;
GRANT ALL ON public.todos TO service_role;

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own or created todos"
ON public.todos FOR SELECT TO authenticated
USING (auth.uid() = user_id OR auth.uid() = created_by);

CREATE POLICY "Users can create todos they own or assign"
ON public.todos FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Assignee or creator can update todos"
ON public.todos FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR auth.uid() = created_by)
WITH CHECK (auth.uid() = user_id OR auth.uid() = created_by);

CREATE POLICY "Assignee or creator can delete todos"
ON public.todos FOR DELETE TO authenticated
USING (auth.uid() = user_id OR auth.uid() = created_by);

CREATE TRIGGER update_todos_updated_at
BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();