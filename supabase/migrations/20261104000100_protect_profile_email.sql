-- profiles.email を本人が書き換えられないようにする(管理者判定やなりすまし表示を防ぐ)
-- メールは auth.users と同じ値を保つ。変更は管理者か service role だけ。
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.stripe_customer_id := old.stripe_customer_id;
    new.email := old.email;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
