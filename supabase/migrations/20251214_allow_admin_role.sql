-- Allow the new ADMINISTRATIVO role to be inserted into users.role
ALTER TABLE public.users
  ALTER COLUMN role TYPE text USING role::text;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (role IN ('MASTER','ADMINISTRATIVO','USER'));
