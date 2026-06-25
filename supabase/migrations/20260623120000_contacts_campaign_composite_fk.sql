-- Harden contacts.campaign_id against cross-org references.
--
-- The Phase 1 schema declared campaign_id as a PLAIN FK to campaigns(id), so a
-- contact in org A could be pointed at org B's campaign UUID — createContact,
-- updateContact (reassign), and the Apollo CSV import all accept campaign_id
-- from user input scoped only by `org_id = caller`. Org B then deleting that
-- campaign would ON DELETE CASCADE org A's contact. Every other cross-table
-- link already uses the composite (id, org_id) FK to keep references inside one
-- org (see sequence_steps, email_events, suppressions); this brings contacts in
-- line. campaigns already carries `campaigns_id_org_uk unique (id, org_id)`
-- (added in the Phase 5 migration), so the composite target already exists.
--
-- ON DELETE CASCADE is preserved (deleting a campaign still deletes its
-- contacts) — only the cross-org reachability changes.

alter table public.contacts
  drop constraint contacts_campaign_id_fkey;

alter table public.contacts
  add constraint contacts_campaign_id_org_id_fkey
  foreign key (campaign_id, org_id)
  references public.campaigns (id, org_id) on delete cascade;
