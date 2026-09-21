-- Adult self-measurement protocols verified against KSPO on 2026-09-21.
-- Keep previous catalogs immutable so existing records retain their definitions.
ALTER TYPE "MeasurementEntryMethod" ADD VALUE 'self_assessment';

INSERT INTO measurement_catalogs (version, checked_on)
VALUES ('nfa100-2026-09-21-self-v1', DATE '2026-09-21');

INSERT INTO measurement_definitions
(catalog_version, code, label, category, factor, unit, value_type, min_age, max_age, min_value, min_inclusive, max_value, source_urls)
SELECT 'nfa100-2026-09-21-self-v1', code, label, category, factor, unit, value_type, min_age, max_age, min_value, min_inclusive, max_value, source_urls
FROM measurement_definitions WHERE catalog_version = 'nfa100-2026-09-19';

INSERT INTO measurement_definitions
(catalog_version, code, label, category, factor, unit, value_type, min_age, max_age, min_value, min_inclusive, max_value, source_urls) VALUES
('nfa100-2026-09-21-self-v1', 'self_curl_up', '윗몸말아올리기(자가측정)', 'health_fitness', 'muscular_endurance', '회', 'integer', 19, 64, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo']),
('nfa100-2026-09-21-self-v1', 'ymca_recovery_heart_rate', 'YMCA 스텝검사 회복 심박수', 'health_fitness', 'cardiorespiratory_endurance', 'bpm', 'integer', 19, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/measure/self/selectSelfMeasureItem.kspo']);
