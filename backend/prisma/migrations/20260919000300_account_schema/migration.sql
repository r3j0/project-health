BEGIN;

-- No synthetic emails or passwords are backfilled. Existing populated systems
-- must obtain real login emails before applying this NOT NULL change.
ALTER TABLE users
  ADD COLUMN email TEXT NOT NULL,
  ADD COLUMN password TEXT,
  ADD COLUMN updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT user_email_normalized CHECK (
    email = lower(btrim(email)) AND email <> '' AND position('@' IN email) > 1
  ),
  ADD CONSTRAINT user_password_not_empty CHECK (password IS NULL OR length(password) > 0);

CREATE UNIQUE INDEX users_email_key ON users(email);

CREATE FUNCTION update_user_timestamp() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_user_timestamp();

COMMIT;
