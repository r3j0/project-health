BEGIN;

-- Retire adult self curl-ups from new measurements without rewriting published
-- catalogs, deleting historic items, or changing their evaluation snapshots.
INSERT INTO measurement_catalogs (version, checked_on)
VALUES ('nfa100-2026-09-24', DATE '2026-09-24');

INSERT INTO measurement_definitions (
  catalog_version, code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
)
SELECT 'nfa100-2026-09-24', code, label, category, factor, unit, value_type,
  min_age, max_age, min_value, min_inclusive, max_value, source_urls
FROM measurement_definitions
WHERE catalog_version = 'nfa100-2026-09-23' AND code <> 'self_curl_up';

-- Legacy definitions and constraints remain available for editing old records.
-- The API independently rejects new retired items even with an older catalog.
COMMIT;
