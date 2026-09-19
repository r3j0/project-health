BEGIN;

CREATE TABLE measurement_create_requests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  key UUID NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  measurement_id UUID REFERENCES measurements(id) ON DELETE SET NULL ON UPDATE RESTRICT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT measurement_create_requests_pkey PRIMARY KEY (user_id, key)
);
CREATE UNIQUE INDEX measurement_create_requests_measurement_id_key
  ON measurement_create_requests(measurement_id);

COMMIT;
