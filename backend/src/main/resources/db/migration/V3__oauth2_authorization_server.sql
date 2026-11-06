-- Spring Authorization Server tables (PostgreSQL variants of the schema shipped in the jar).
-- MCP clients (claude.ai, Claude Code, Inspector) register here dynamically.

create table oauth2_registered_client (
    id                            varchar(100)  not null primary key,
    client_id                     varchar(100)  not null,
    client_id_issued_at           timestamptz   not null default now(),
    client_secret                 varchar(200),
    client_secret_expires_at      timestamptz,
    client_name                   varchar(200)  not null,
    client_authentication_methods varchar(1000) not null,
    authorization_grant_types     varchar(1000) not null,
    redirect_uris                 varchar(1000),
    post_logout_redirect_uris     varchar(1000),
    scopes                        varchar(1000) not null,
    client_settings               varchar(2000) not null,
    token_settings                varchar(2000) not null
);
create unique index oauth2_registered_client_client_id_idx on oauth2_registered_client (client_id);

create table oauth2_authorization (
    id                            varchar(100) not null primary key,
    registered_client_id          varchar(100) not null,
    principal_name                varchar(200) not null,
    authorization_grant_type      varchar(100) not null,
    authorized_scopes             varchar(1000),
    attributes                    text,
    state                         varchar(500),
    authorization_code_value      text,
    authorization_code_issued_at  timestamptz,
    authorization_code_expires_at timestamptz,
    authorization_code_metadata   text,
    access_token_value            text,
    access_token_issued_at        timestamptz,
    access_token_expires_at       timestamptz,
    access_token_metadata         text,
    access_token_type             varchar(100),
    access_token_scopes           varchar(1000),
    oidc_id_token_value           text,
    oidc_id_token_issued_at       timestamptz,
    oidc_id_token_expires_at      timestamptz,
    oidc_id_token_metadata        text,
    refresh_token_value           text,
    refresh_token_issued_at       timestamptz,
    refresh_token_expires_at      timestamptz,
    refresh_token_metadata        text,
    user_code_value               text,
    user_code_issued_at           timestamptz,
    user_code_expires_at          timestamptz,
    user_code_metadata            text,
    device_code_value             text,
    device_code_issued_at         timestamptz,
    device_code_expires_at        timestamptz,
    device_code_metadata          text
);
create index oauth2_authorization_principal_idx on oauth2_authorization (principal_name);
create index oauth2_authorization_expires_idx on oauth2_authorization (access_token_expires_at);

create table oauth2_authorization_consent (
    registered_client_id varchar(100)  not null,
    principal_name       varchar(200)  not null,
    authorities          varchar(1000) not null,
    primary key (registered_client_id, principal_name)
);

-- The RSA key that signs MCP access tokens. Generated on first boot and kept, so tokens
-- survive redeploys.
create table signing_keys (
    id         varchar(64) primary key,
    jwk        text        not null,
    created_at timestamptz not null default now()
);
