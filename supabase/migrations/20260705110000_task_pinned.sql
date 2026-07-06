-- Sticky-note pin: a per-task importance flag surfaced by the per-theme pin visual
-- and a quick filter. Never a sort key — manual drag order stays authoritative.
alter table public.tasks add column pinned boolean not null default false;
