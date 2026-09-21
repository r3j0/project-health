BEGIN;

-- Product scope correction: remove preferences and personal fitness goals.
-- Existing measurements, account credentials, currency, assignments and sessions
-- remain intact. Do not rewrite already published migrations.
DROP TABLE user_fitness_goals;
DROP FUNCTION validate_fitness_goal();
ALTER TABLE users DROP COLUMN preferred_exercises, DROP COLUMN exercise_goals;
DROP INDEX measurements_user_id_measured_on_created_at_id_idx;

COMMIT;
