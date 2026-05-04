INSERT INTO public.releases (version, title, summary, status, changes, created_by)
SELECT 'v1.4.5', '', '', 'draft',
  '[
    {"type":"feature","description":"New Suppliers Directory under Operations: track suppliers/stakeholders with contacts, services, commercials and links to live workstreams."},
    {"type":"feature","description":"Add and edit suppliers directly from the directory (admins only); everyone can browse."},
    {"type":"improvement","description":"Planner Diary is now fully mobile-friendly in portrait and landscape, with a dedicated touch-optimised agenda view, grouped by date and respecting your timezone preference."},
    {"type":"improvement","description":"Planner toolbar wraps cleanly on small screens with larger touch targets; horizontal scrolling and clipped controls fixed."}
  ]'::jsonb,
  (SELECT user_id FROM public.user_roles WHERE role = 'admin' ORDER BY id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM public.releases WHERE status = 'draft');