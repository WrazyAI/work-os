-- People can be kept in the roster while being left out of Insights.
-- Use for test accounts, shared inboxes, and roles that should not be counted
-- in team analytics. The default is inclusive; administrators opt people out.
alter table work_people
  add column if not exists excluded_from_insights boolean not null default false;
