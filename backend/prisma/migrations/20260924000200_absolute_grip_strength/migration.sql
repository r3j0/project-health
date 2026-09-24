BEGIN;

-- Publish a new catalog; existing definitions and stored evaluations are immutable.
INSERT INTO measurement_catalogs (version, checked_on)
VALUES ('nfa100-2026-09-24-grip-v1', DATE '2026-09-24');

INSERT INTO measurement_definitions (
  catalog_version, code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
)
SELECT 'nfa100-2026-09-24-grip-v1', code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
FROM measurement_definitions WHERE catalog_version = 'nfa100-2026-09-24';

INSERT INTO measurement_definitions (
  catalog_version, code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
) VALUES (
  'nfa100-2026-09-24-grip-v1', 'absolute_grip_strength', '절대악력',
  'health_fitness', 'strength', 'kg', 'decimal', 13, 64, 0, true, NULL,
  ARRAY['https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo',
        'https://nfa.kspo.or.kr/community/faq/selectFaqList.kspo']
);

COMMIT;
