create table diagrams (
    id          uuid primary key,
    title       text        not null,
    kind        text        not null,
    document    jsonb       not null,
    version     integer     not null default 1,
    share_token text        unique,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index diagrams_updated_at_idx on diagrams (updated_at desc);
