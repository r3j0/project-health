BEGIN;

ALTER TABLE users
  ADD COLUMN preferred_exercises TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN exercise_goals TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE TABLE user_currencies (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Existing accounts retain all data; only their new currency row is initialized.
INSERT INTO user_currencies (user_id) SELECT id FROM users;

CREATE TABLE user_fitness_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  catalog_version TEXT NOT NULL,
  code TEXT NOT NULL,
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT goal_value_finite CHECK (value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  FOREIGN KEY (catalog_version, code, unit) REFERENCES measurement_definitions(catalog_version, code, unit) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX user_fitness_goals_user_id_code_key ON user_fitness_goals(user_id, code);
CREATE INDEX user_fitness_goals_catalog_version_code_unit_idx ON user_fitness_goals(catalog_version, code, unit);

CREATE FUNCTION validate_fitness_goal() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  def measurement_definitions%ROWTYPE;
BEGIN
  SELECT * INTO def FROM measurement_definitions
    WHERE catalog_version = NEW.catalog_version AND code = NEW.code;
  IF FOUND AND (
    (def.value_type = 'integer' AND NEW.value <> trunc(NEW.value))
    OR (def.min_value IS NOT NULL AND (NEW.value < def.min_value OR (NOT def.min_inclusive AND NEW.value = def.min_value)))
    OR (def.max_value IS NOT NULL AND NEW.value > def.max_value)
  ) THEN
    RAISE EXCEPTION 'Fitness goal violates its number format or value bounds.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fitness_goal_valid BEFORE INSERT OR UPDATE ON user_fitness_goals
FOR EACH ROW EXECUTE FUNCTION validate_fitness_goal();

CREATE INDEX measurements_user_id_measured_on_created_at_id_idx ON measurements(user_id, measured_on DESC, created_at DESC, id);

CREATE TYPE "CurriculumAssignmentStatus" AS ENUM ('assigned', 'completed');
CREATE TABLE workout_curricula (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE user_curriculum_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  curriculum_id UUID NOT NULL REFERENCES workout_curricula(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  request_key UUID NOT NULL,
  current_for_user_id UUID REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  status "CurriculumAssignmentStatus" NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ(6),
  CONSTRAINT assignment_current_owner CHECK (current_for_user_id IS NULL OR current_for_user_id = user_id),
  CONSTRAINT assignment_state CHECK (
    (status = 'assigned' AND completed_at IS NULL AND current_for_user_id IS NOT NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= assigned_at)
  )
);
CREATE UNIQUE INDEX user_curriculum_assignments_current_for_user_id_key ON user_curriculum_assignments(current_for_user_id);
CREATE UNIQUE INDEX user_curriculum_assignments_user_id_request_key_key ON user_curriculum_assignments(user_id, request_key);
CREATE INDEX user_curriculum_assignments_user_id_assigned_at_id_idx ON user_curriculum_assignments(user_id, assigned_at DESC, id);
CREATE INDEX user_curriculum_assignments_curriculum_id_idx ON user_curriculum_assignments(curriculum_id);

-- Definition identity and assignment history cannot silently change meaning.
CREATE FUNCTION protect_curriculum_definition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Curriculum definitions are immutable; create a new definition.' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER curriculum_definition_immutable BEFORE UPDATE ON workout_curricula
FOR EACH ROW EXECUTE FUNCTION protect_curriculum_definition();

CREATE FUNCTION protect_assignment_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.curriculum_id, NEW.request_key, NEW.assigned_at)
     IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.curriculum_id, OLD.request_key, OLD.assigned_at)
     OR (OLD.status = 'completed' AND (NEW.status, NEW.completed_at) IS DISTINCT FROM (OLD.status, OLD.completed_at))
     OR (OLD.current_for_user_id IS NULL AND NEW.current_for_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Assignment identity and completed history are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_history_immutable BEFORE UPDATE ON user_curriculum_assignments
FOR EACH ROW EXECUTE FUNCTION protect_assignment_history();

COMMIT;
