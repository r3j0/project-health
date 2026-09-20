BEGIN;

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  revoked_at TIMESTAMPTZ(6),
  CONSTRAINT auth_session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

-- Retain consumed token hashes until session expiry to detect replay.
CREATE TABLE auth_refresh_tokens (
  token_hash CHAR(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ(6)
);
CREATE INDEX auth_refresh_tokens_session_id_idx ON auth_refresh_tokens(session_id);

CREATE TABLE auth_rate_limits (
  key CHAR(64) PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX auth_rate_limits_expires_at_idx ON auth_rate_limits(expires_at);

COMMIT;
