-- Make a deliberate membership deactivation durable.
--
-- The previous definition re-activated every matched membership on any profile
-- write (`active = true` in the ON CONFLICT clause). An operator who deactivated
-- a stray membership could not keep it deactivated: the next profile update
-- silently restored it, which also changed which organization the user resolved
-- to. Linking the person is still refreshed on conflict; the active flag now
-- belongs to the operator.

create or replace function public.work_link_profile_person()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update work_people
     set auth_user_id = new.id, updated_at = now()
   where auth_user_id is null
     and email is not null
     and new.email is not null
     and lower(trim(email)) = lower(trim(new.email));

  insert into work_org_members (organization_id, user_id, person_id, role)
  select organization_id, new.id, id, 'employee'
    from work_people
   where auth_user_id = new.id
     and organization_id is not null
  on conflict (organization_id, user_id)
  do update set person_id = excluded.person_id, updated_at = now();

  return new;
end
$function$;
