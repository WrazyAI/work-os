-- Backfill all existing users to admin for the initial Admin Controls rollout.
-- Existing semantics remain owner=Admin, member=User.

update profiles
set role = 'owner'
where role = 'member';
