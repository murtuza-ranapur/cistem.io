-- Projects: named groups of diagrams. Every diagram belongs to exactly one project (the service always sets
-- project_id; the column stays nullable only for legacy rows without an owner).

create table projects (
    id          uuid primary key,
    owner_id    uuid        not null references users (id) on delete cascade,
    title       text        not null,
    share_token text        unique,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index projects_owner_idx on projects (owner_id, updated_at desc);

alter table diagrams add column project_id uuid references projects (id) on delete cascade;
create index diagrams_project_idx on diagrams (project_id);

-- Backfill: each existing owner gets a "My diagrams" project holding all their diagrams.
insert into projects (id, owner_id, title, created_at, updated_at)
select gen_random_uuid(), owner_id, 'My diagrams', min(created_at), max(updated_at)
from diagrams
where owner_id is not null
group by owner_id;

update diagrams d
set project_id = p.id
from projects p
where p.owner_id = d.owner_id and d.owner_id is not null;
