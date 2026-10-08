-- Accounts: setup codes, and a stricter "signed in" check.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Shared camp info (settings, teams, camp updates, ...) is readable only
-- by people with a Campus account, not by any sign-in that lacks one.
-- ---------------------------------------------------------------------
create or replace function public.has_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people where auth_user_id = auth.uid())
$$;
revoke execute on function public.has_account from public, anon;
grant execute on function public.has_account to authenticated;

alter policy "read events" on public.events using (public.has_account());
alter policy "read settings" on public.settings using (public.has_account());
alter policy "read teams" on public.teams using (public.has_account());
alter policy "read grade items" on public.grade_items using (public.has_account());
alter policy "read camp updates" on public.camp_updates using (public.has_account());
alter policy "read past resources" on public.past_resources using (public.has_account());
alter policy "read published posts" on public.posts using ((published and public.has_account()) or public.is_admin());
alter policy "read visible merch" on public.merch_items using ((visible and public.has_account()) or public.is_admin());
alter policy "read visible challenges" on public.challenges using ((visible and public.has_account()) or public.is_admin());
alter policy "signed-in users view photos" on storage.objects using (bucket_id = 'avatars' and public.has_account());

-- ---------------------------------------------------------------------
-- Setup codes: 8 characters from an alphabet without look-alikes
-- (no 0/O, 1/I/L), shown as XXXX-XXXX.
-- ---------------------------------------------------------------------
create or replace function public.random_setup_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  out text := '';
begin
  for i in 0..7 loop
    out := out || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
    if i = 3 then out := out || '-'; end if;
  end loop;
  return out;
end $$;
revoke execute on function public.random_setup_code from public, anon, authenticated;

-- Admins: issue a new code (first sign-up, or a password reset). Any
-- unused code for that person stops working.
create or replace function public.admin_new_setup_code(p_person uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  new_code text := public.random_setup_code();
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  delete from public.setup_codes where person_id = p_person and used_at is null;
  insert into public.setup_codes (person_id, code, created_by) values (p_person, new_code, public.me());
  return new_code;
end $$;
revoke execute on function public.admin_new_setup_code from public, anon;
grant execute on function public.admin_new_setup_code to authenticated;

-- New people get a setup code automatically.
create or replace function public.give_setup_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.auth_user_id is null then
    insert into public.setup_codes (person_id, code) values (new.id, public.random_setup_code());
  end if;
  return new;
end $$;
create trigger people_setup_code after insert on public.people
  for each row execute function public.give_setup_code();
