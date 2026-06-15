-- Grant Pratik (user 3b8d4435-6d70-4c95-8b0b-272d8c458bbb) read/manage access to Registrations data
-- without granting full admin role.

CREATE POLICY "Pratik can view school registrations"
  ON public.school_registrations FOR SELECT
  TO authenticated
  USING (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);

CREATE POLICY "Pratik can delete school registrations"
  ON public.school_registrations FOR DELETE
  TO authenticated
  USING (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);

CREATE POLICY "Pratik can view event attendees"
  ON public.event_attendees FOR SELECT
  TO authenticated
  USING (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);

CREATE POLICY "Pratik can insert event attendees"
  ON public.event_attendees FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);

CREATE POLICY "Pratik can update event attendees"
  ON public.event_attendees FOR UPDATE
  TO authenticated
  USING (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);

CREATE POLICY "Pratik can delete event attendees"
  ON public.event_attendees FOR DELETE
  TO authenticated
  USING (auth.uid() = '3b8d4435-6d70-4c95-8b0b-272d8c458bbb'::uuid);