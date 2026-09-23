-- Additive only: no historic evaluation or reported-grade backfill.
ALTER TYPE "MeasurementEntryMethod" ADD VALUE 'self_assessment';

BEGIN;

ALTER TABLE measurement_items ADD COLUMN evaluation JSONB;
ALTER TABLE measurements ADD CONSTRAINT self_assessment_adult
  CHECK (entry_method::text <> 'self_assessment' OR age_at_measurement BETWEEN 19 AND 64);

-- Published catalogs are immutable. Old clients can keep their existing version.
INSERT INTO measurement_catalogs (version, checked_on)
VALUES ('nfa100-2026-09-23', DATE '2026-09-23');
INSERT INTO measurement_definitions (
  catalog_version, code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
)
SELECT 'nfa100-2026-09-23', code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
FROM measurement_definitions WHERE catalog_version = 'nfa100-2026-09-19';

INSERT INTO measurement_definitions (
  catalog_version, code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
) VALUES
('nfa100-2026-09-23', 'self_curl_up', '성인 자가측정용 윗몸말아올리기',
 'health_fitness', 'muscular_endurance', '회', 'integer', 19, 64, 0, true, NULL,
 ARRAY['https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo']),
('nfa100-2026-09-23', 'ymca_recovery_heart_rate', 'YMCA 회복 심박수',
 'health_fitness', 'cardiorespiratory_endurance', 'bpm', 'decimal', 19, 64, 0, false, NULL,
 ARRAY['https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo']);

-- Keep the existing deferred validator, including parent-row locking, and add
-- final-state checks so values and evaluation revisions commit atomically.
CREATE OR REPLACE FUNCTION validate_measurement_record(record_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  record_age integer;
  record_revision integer;
  record_method text;
BEGIN
  SELECT age_at_measurement, revision, entry_method::text
    INTO record_age, record_revision, record_method
    FROM measurements WHERE id = record_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (SELECT 1 FROM measurement_items WHERE measurement_id = record_id) THEN
    RAISE EXCEPTION 'A measurement must contain at least one item.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM measurement_items item
    JOIN measurement_definitions def ON def.catalog_version = item.catalog_version AND def.code = item.code
    WHERE item.measurement_id = record_id AND (
      record_age < def.min_age OR record_age > def.max_age
      OR (def.value_type = 'integer' AND item.value <> trunc(item.value))
      OR (def.min_value IS NOT NULL AND (
        item.value < def.min_value OR (NOT def.min_inclusive AND item.value = def.min_value)
      ))
      OR (def.max_value IS NOT NULL AND item.value > def.max_value)
      OR (record_method = 'self_assessment' AND item.code NOT IN (
        'height', 'weight', 'bmi', 'waist_circumference', 'cross_sit_up',
        'self_curl_up', 'ymca_recovery_heart_rate', 'sit_and_reach'
      ))
    )
  ) THEN
    RAISE EXCEPTION 'Measurement item violates its method, age, number format, or value bounds.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM measurement_items item
    WHERE item.measurement_id = record_id AND item.evaluation IS NOT NULL AND (
      jsonb_typeof(item.evaluation) IS DISTINCT FROM 'object'
      OR item.evaluation->>'measurementId' IS DISTINCT FROM record_id::text
      OR item.evaluation->>'measurementCode' IS DISTINCT FROM item.code
      OR item.evaluation->>'recordRevision' IS DISTINCT FROM record_revision::text
    )
  ) THEN
    RAISE EXCEPTION 'Evaluation must match its measurement, item and revision.' USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
