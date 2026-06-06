
ALTER TABLE public.school_registrations
  ADD COLUMN number_of_schools INTEGER,
  ADD COLUMN role TEXT CHECK (role IN ('Owner', 'Principal', 'Educator'));
