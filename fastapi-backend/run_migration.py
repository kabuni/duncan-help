"""
One-time database setup script.
Run this ONCE as azure_pg_admin to create the auth tables duncan_db cannot create itself.

Usage:
    DB_ADMIN_USER=azure_pg_admin DB_ADMIN_PASSWORD=<password> python run_migration.py

Or with inline credentials:
    set DB_ADMIN_USER=azure_pg_admin
    set DB_ADMIN_PASSWORD=yourpassword
    python run_migration.py
"""
import asyncio
import asyncpg
import ssl
import os
from dotenv import load_dotenv

load_dotenv()

from app.config import settings

ADMIN_USER = os.environ.get("DB_ADMIN_USER") or settings.AZURE_PG_USER
ADMIN_PASS = os.environ.get("DB_ADMIN_PASSWORD") or settings.AZURE_PG_PASSWORD

MIGRATION_SQL = """
-- Auth credentials: stores hashed password + approval status per user
CREATE TABLE IF NOT EXISTS auth_credentials (
    user_id         uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hashed_password text        NOT NULL,
    approval_status text        NOT NULL DEFAULT 'pending'
                                CHECK (approval_status IN ('pending', 'active', 'suspended')),
    role_title      text,
    department      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Refresh tokens for JWT rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    token_hash  text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Password reset tokens (1-hour expiry)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    token_hash  text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Meetings
CREATE TABLE IF NOT EXISTS meetings (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text        NOT NULL,
    description     text,
    date            timestamptz,
    duration_mins   integer,
    transcript      text,
    ai_summary      text,
    ai_action_items jsonb,
    analyzed_at     timestamptz,
    created_by      uuid        REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_participants (
    id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id  uuid    NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id     uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (meeting_id, user_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       text,
    body        text,
    type        text,
    read        boolean     NOT NULL DEFAULT FALSE,
    data        jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Recruitment
CREATE TABLE IF NOT EXISTS job_roles (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title                text        NOT NULL,
    department           text,
    description          text,
    status               text        NOT NULL DEFAULT 'active',
    hireflix_position_id text,
    created_by           uuid        REFERENCES users(id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_role_id            uuid        REFERENCES job_roles(id),
    name                   text,
    email                  text,
    cv_blob_path           text,
    cv_text                text,
    parsed_cv              jsonb,
    values_score           numeric,
    competency_score       numeric,
    status                 text        NOT NULL DEFAULT 'new',
    hireflix_interview_id  text,
    hireflix_status        text,
    hireflix_recording_url text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hireflix_retry_queue (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id     text        NOT NULL,
    email           text        NOT NULL,
    attempts        integer     NOT NULL DEFAULT 0,
    last_error      text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- CEO Briefings
CREATE TABLE IF NOT EXISTS ceo_briefings (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     text,
    date        date        NOT NULL,
    shown       boolean     NOT NULL DEFAULT FALSE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, date)
);

CREATE TABLE IF NOT EXISTS ceo_briefing_jobs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id),
    job_type     text,
    status       text        NOT NULL DEFAULT 'pending',
    result       text,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ceo_action_routing (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    briefing_id uuid        REFERENCES ceo_briefings(id),
    user_id     uuid        REFERENCES users(id),
    action_text text,
    assigned_to uuid        REFERENCES users(id),
    status      text        NOT NULL DEFAULT 'pending',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Releases
CREATE TABLE IF NOT EXISTS releases (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    version          text        NOT NULL,
    notes            text,
    changes          jsonb,
    breaking_changes jsonb,
    created_by       uuid        REFERENCES users(id),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS release_email_logs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id      uuid        REFERENCES releases(id),
    recipient_email text,
    sent_at         timestamptz NOT NULL DEFAULT now()
);

-- Misc
CREATE TABLE IF NOT EXISTS social_stats_snapshots (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    data       jsonb       NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_integrations (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_name text        NOT NULL UNIQUE,
    config           jsonb       NOT NULL DEFAULT '{}',
    enabled          boolean     NOT NULL DEFAULT FALSE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_integrations (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    integration_name text        NOT NULL,
    credentials      jsonb       NOT NULL DEFAULT '{}',
    scope            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, integration_name)
);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        REFERENCES users(id),
    integration_name text,
    action           text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gmail_tokens (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    access_token  text        NOT NULL,
    refresh_token text,
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title      text        NOT NULL,
    content    text,
    created_by uuid        REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- NDA submissions + vector search
CREATE TABLE IF NOT EXISTS nda_submissions (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    submitter_id          uuid        REFERENCES users(id),
    submitter_email       text        NOT NULL,
    receiving_party_name  text        NOT NULL,
    receiving_party_entity text       NOT NULL,
    date_of_agreement     date        NOT NULL,
    registered_address    text        NOT NULL,
    purpose               text        NOT NULL,
    recipient_name        text        NOT NULL,
    recipient_email       text        NOT NULL,
    internal_signer_name  text        NOT NULL DEFAULT 'Palash Soundarkar',
    internal_signer_email text        NOT NULL DEFAULT 'palash@kabuni.com',
    docusign_envelope_id  text,
    google_doc_id         text,
    google_doc_url        text,
    notion_page_id        text,
    notion_page_url       text,
    status                text        NOT NULL DEFAULT 'generating',
    last_error            text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nda_chunks (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nda_id      uuid        NOT NULL REFERENCES nda_submissions(id) ON DELETE CASCADE,
    chunk_index integer     NOT NULL,
    content     text        NOT NULL,
    token_count integer,
    embedding   vector(1536),
    metadata    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
"""

GRANT_SQL = """
DO $$ DECLARE t text;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'auth_credentials','refresh_tokens','password_reset_tokens',
        'meetings','meeting_participants','notifications',
        'job_roles','candidates','hireflix_retry_queue',
        'ceo_briefings','ceo_briefing_jobs','ceo_action_routing',
        'releases','release_email_logs','social_stats_snapshots',
        'company_integrations','user_integrations','integration_audit_logs',
        'gmail_tokens','wiki_pages',
        'nda_submissions','nda_chunks'
    ]) LOOP
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO duncan_db', t);
    END LOOP;
END $$;
"""


async def run():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    print(f"Connecting as: {ADMIN_USER}")
    conn = await asyncpg.connect(
        host=settings.AZURE_PG_HOST,
        port=settings.AZURE_PG_PORT,
        database=settings.AZURE_PG_DATABASE,
        user=ADMIN_USER,
        password=ADMIN_PASS,
        ssl=ctx,
    )

    # Split on semicolons, skipping $$ blocks
    statements = _split_sql(MIGRATION_SQL + GRANT_SQL)
    ok = 0
    for stmt in statements:
        stmt = stmt.strip()
        if not stmt:
            continue
        try:
            await conn.execute(stmt)
            ok += 1
        except asyncpg.exceptions.DuplicateObjectError:
            print(f"  [skip] already exists: {stmt[:60]}")
        except Exception as e:
            print(f"  [error] {e}  |  SQL: {stmt[:100]}")

    print(f"\nDone — {ok} statements executed.")

    print("\nNext step — bootstrap yourself as admin:")
    print("  UPDATE auth_credentials SET approval_status = 'active'")
    print("    WHERE user_id = (SELECT id FROM users WHERE email = 'you@kabuni.com');")
    print()
    print("  INSERT INTO user_roles (id, user_id, role)")
    print("    SELECT gen_random_uuid(), id, 'admin'::app_role FROM users WHERE email = 'you@kabuni.com'")
    print("    ON CONFLICT DO NOTHING;")

    await conn.close()


def _split_sql(sql: str) -> list[str]:
    statements, current, in_dollar = [], [], False
    for line in sql.splitlines():
        if "$$" in line:
            in_dollar = not in_dollar
        current.append(line)
        if not in_dollar and line.rstrip().endswith(";"):
            statements.append("\n".join(current))
            current = []
    if current:
        statements.append("\n".join(current))
    return statements


if __name__ == "__main__":
    asyncio.run(run())
