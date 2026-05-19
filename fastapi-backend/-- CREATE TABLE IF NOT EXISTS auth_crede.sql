-- CREATE TABLE IF NOT EXISTS auth_credentials (
--     user_id         uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
--     hashed_password text        NOT NULL,
--     approval_status text        NOT NULL DEFAULT 'pending'
--                                 CHECK (approval_status IN ('pending', 'active', 'suspended')),
--     role_title      text,
--     department      text,
--     created_at      timestamptz NOT NULL DEFAULT now(),
--     updated_at      timestamptz NOT NULL DEFAULT now()
-- );

-- CREATE TABLE IF NOT EXISTS refresh_tokens (
--     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
--     user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
--     token_hash  text        NOT NULL,
--     expires_at  timestamptz NOT NULL,
--     created_at  timestamptz NOT NULL DEFAULT now()
-- );

-- CREATE TABLE IF NOT EXISTS password_reset_tokens (
--     id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
--     user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
--     token_hash  text        NOT NULL,
--     expires_at  timestamptz NOT NULL,
--     created_at  timestamptz NOT NULL DEFAULT now()
-- );

-- GRANT SELECT,INSERT,UPDATE,DELETE ON auth_credentials, refresh_tokens, password_reset_tokens TO duncan_db;


-- -- Activate your account
-- UPDATE auth_credentials 
-- SET approval_status = 'active'
-- WHERE user_id = (SELECT id FROM users WHERE email = 'balkrishna@kabuni.com');

-- UPDATE users 
-- SET is_active = TRUE 
-- WHERE email = 'balkrishna@kabuni.com';

-- -- Give yourself the admin role
-- INSERT INTO user_roles (id, user_id, role)
-- SELECT gen_random_uuid(), id, 'admin'::app_role 
-- FROM users WHERE email = 'balkrishna@kabuni.com'
-- ON CONFLICT DO NOTHING;


-- NDA submissions
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

-- Grant access to the app user
GRANT SELECT, INSERT, UPDATE, DELETE ON nda_submissions TO duncan_db;
GRANT SELECT, INSERT, UPDATE, DELETE ON nda_chunks TO duncan_db;
