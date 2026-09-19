-- Reference data verified against KSPO sources on 2026-09-19. No user or example records.
BEGIN;

INSERT INTO measurement_catalogs (version, checked_on) VALUES ('nfa100-2026-09-19', DATE '2026-09-19');

INSERT INTO measurement_definitions (catalog_version, code, label, category, factor, unit, value_type, min_age, max_age, min_value, min_inclusive, max_value, source_urls) VALUES
('nfa100-2026-09-19', 'height', '신장', 'physique', 'body_composition', 'cm', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'weight', '체중', 'physique', 'body_composition', 'kg', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'body_fat_percentage', '체지방률', 'physique', 'body_composition', '%', 'decimal', 13, 64, 0, true, 100, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'waist_circumference', '허리둘레', 'physique', 'body_composition', 'cm', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'bmi', 'BMI', 'physique', 'body_composition', 'kg/m²', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'relative_grip_strength', '상대악력', 'health_fitness', 'strength', '%', 'decimal', 13, 64, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'curl_up', '윗몸말아올리기', 'health_fitness', 'muscular_endurance', '회', 'integer', 13, 18, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'repeated_jump', '반복점프', 'health_fitness', 'muscular_endurance', '회', 'integer', 13, 18, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'cross_sit_up', '교차윗몸일으키기', 'health_fitness', 'muscular_endurance', '회', 'integer', 19, 64, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'shuttle_run_20m', '왕복오래달리기(20m)', 'health_fitness', 'cardiorespiratory_endurance', '회', 'integer', 13, 64, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'treadmill_vo2max', '트레드밀(VO₂max)', 'health_fitness', 'cardiorespiratory_endurance', 'ml/kg/min', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'step_test_vo2max', '스텝검사(VO₂max)', 'health_fitness', 'cardiorespiratory_endurance', 'ml/kg/min', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/0/selectMeasureGradeItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'sit_and_reach', '앉아윗몸앞으로굽히기', 'health_fitness', 'flexibility', 'cm', 'decimal', 13, 64, NULL, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'illinois_agility', '일리노이', 'motor_fitness', 'agility', '초', 'decimal', 13, 18, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'shuttle_run_10m_4', '10M 4회 왕복달리기', 'motor_fitness', 'agility', '초', 'decimal', 19, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'reaction_time', '반응시간', 'motor_fitness', 'agility', '초', 'decimal', 19, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'standing_long_jump', '제자리 멀리뛰기', 'motor_fitness', 'power', 'cm', 'decimal', 19, 64, 0, true, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 'flight_time', '체공시간', 'motor_fitness', 'power', '초', 'decimal', 13, 64, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo','https://nfa.kspo.or.kr/reserve/3/selectMeasureItemListByAgeSe.kspo']),
('nfa100-2026-09-19', 't_wall_coordination', '눈–손 협응력(T-wall)', 'motor_fitness', 'coordination', '초', 'decimal', 13, 18, 0, false, NULL, ARRAY['https://nfa.kspo.or.kr/reserve/2/selectMeasureItemListByAgeSe.kspo']);

COMMIT;
