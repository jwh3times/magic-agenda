-- ---------------------------------------------------------------------------
-- A password set before an address was confirmed does not survive the confirmation
-- ---------------------------------------------------------------------------
-- Sign-up is open, and the auth server keeps the FIRST password ever submitted for an unconfirmed
-- address: a repeat sign-up does not replace it, and confirming by emailed link does not clear it.
-- So anyone could register someone else's address with a password of their own, wait for the real
-- owner to confirm, and then sign in as them. The server cannot tell who set the stored password,
-- so the only safe rule is that nobody's survives: the password is discarded at the moment the
-- address is first confirmed, and the owner chooses one while signed in from their link
-- (`/auth/reset`, raised by `AuthProvider`).
--
-- The auth server already does exactly this on its OAuth path; the emailed-link path had no
-- equivalent.
--
-- **`confirmation_sent_at is not null` is what separates a self-service sign-up from an
-- administrative one.** `auth.admin.createUser({ email_confirm: true })` also inserts the row
-- unconfirmed and confirms it with an UPDATE in the same request, and its password was set by an
-- operator, not by an unverified stranger. That path never sends a confirmation, so the column is
-- NULL; every self-service sign-up sets it before a link can exist. Without this clause every
-- operator-created account, and every test account, would lose its password at creation.
--
-- Existing accounts are untouched: they are already confirmed, and the trigger fires only on the
-- NULL-to-set transition.
create function public.discard_unverified_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.encrypted_password := null;
  return new;
end;
$$;

-- Explicitly from anon and service_role, not only public (#384). Runs only as a trigger.
revoke all on function public.discard_unverified_password()
  from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_first_confirmed on auth.users;
create trigger on_auth_user_first_confirmed
  before update on auth.users
  for each row
  when (
    old.email_confirmed_at is null
    and new.email_confirmed_at is not null
    and old.confirmation_sent_at is not null
  )
  execute function public.discard_unverified_password();
