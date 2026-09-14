INSERT INTO public.user_roles (user_id, role)
VALUES ('73dc6ae9-36a9-4085-8634-0ea2b31817ab', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;