BEGIN;

-- CreateEnum
CREATE TYPE "MeasurementCategory" AS ENUM ('physique', 'health_fitness', 'motor_fitness');

-- CreateEnum
CREATE TYPE "MeasurementFactor" AS ENUM ('body_composition', 'strength', 'muscular_endurance', 'cardiorespiratory_endurance', 'flexibility', 'agility', 'power', 'coordination');

-- CreateEnum
CREATE TYPE "MeasurementValueType" AS ENUM ('integer', 'decimal');

-- CreateEnum
CREATE TYPE "MeasurementSex" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "MeasurementReportKind" AS ENUM ('standard', 'simple', 'unknown');

-- CreateEnum
CREATE TYPE "MeasurementSource" AS ENUM ('nfa100');

-- CreateEnum
CREATE TYPE "MeasurementEntryMethod" AS ENUM ('manual');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_catalogs" (
    "version" TEXT NOT NULL,
    "checked_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_catalogs_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "measurement_definitions" (
    "catalog_version" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "MeasurementCategory" NOT NULL,
    "factor" "MeasurementFactor" NOT NULL,
    "unit" TEXT NOT NULL,
    "value_type" "MeasurementValueType" NOT NULL,
    "min_age" INTEGER NOT NULL,
    "max_age" INTEGER NOT NULL,
    "min_value" DECIMAL,
    "min_inclusive" BOOLEAN NOT NULL DEFAULT true,
    "max_value" DECIMAL,
    "source_urls" TEXT[],

    CONSTRAINT "measurement_definitions_pkey" PRIMARY KEY ("catalog_version","code")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "measured_on" DATE NOT NULL,
    "age_at_measurement" INTEGER NOT NULL,
    "sex_at_measurement" "MeasurementSex",
    "report_kind" "MeasurementReportKind" NOT NULL DEFAULT 'unknown',
    "center_name" TEXT,
    "reported_overall_grade" TEXT,
    "source_program" "MeasurementSource" NOT NULL DEFAULT 'nfa100',
    "entry_method" "MeasurementEntryMethod" NOT NULL DEFAULT 'manual',
    "catalog_version" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_items" (
    "measurement_id" UUID NOT NULL,
    "catalog_version" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "value" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL,
    "reported_grade" TEXT,

    CONSTRAINT "measurement_items_pkey" PRIMARY KEY ("measurement_id","code")
);

-- CreateIndex
CREATE UNIQUE INDEX "measurement_definitions_catalog_version_code_unit_key" ON "measurement_definitions"("catalog_version", "code", "unit");

-- CreateIndex
CREATE INDEX "measurements_user_id_measured_on_id_idx" ON "measurements"("user_id", "measured_on" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_id_catalog_version_key" ON "measurements"("id", "catalog_version");

-- CreateIndex
CREATE INDEX "measurement_items_catalog_version_code_unit_idx" ON "measurement_items"("catalog_version", "code", "unit");

-- AddForeignKey
ALTER TABLE "measurement_definitions" ADD CONSTRAINT "measurement_definitions_catalog_version_fkey" FOREIGN KEY ("catalog_version") REFERENCES "measurement_catalogs"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_catalog_version_fkey" FOREIGN KEY ("catalog_version") REFERENCES "measurement_catalogs"("version") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "measurement_items" ADD CONSTRAINT "measurement_items_measurement_id_catalog_version_fkey" FOREIGN KEY ("measurement_id", "catalog_version") REFERENCES "measurements"("id", "catalog_version") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "measurement_items" ADD CONSTRAINT "measurement_items_catalog_version_code_unit_fkey" FOREIGN KEY ("catalog_version", "code", "unit") REFERENCES "measurement_definitions"("catalog_version", "code", "unit") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Authoring reference only: these statements are included in the initial migration.
-- PostgreSQL enforces constraints Prisma cannot express in schema.prisma.
ALTER TABLE measurement_definitions
  ALTER COLUMN source_urls SET NOT NULL,
  ADD CONSTRAINT definition_age_range CHECK (min_age >= 13 AND max_age <= 64 AND min_age <= max_age),
  ADD CONSTRAINT definition_sources CHECK (cardinality(source_urls) > 0),
  ADD CONSTRAINT definition_value_range CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value);

ALTER TABLE measurements
  ADD CONSTRAINT measurement_age_range CHECK (age_at_measurement BETWEEN 13 AND 64),
  ADD CONSTRAINT measurement_revision_positive CHECK (revision > 0),
  ADD CONSTRAINT measurement_date_valid CHECK (isfinite(measured_on) AND measured_on <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date);

ALTER TABLE measurement_items
  ADD CONSTRAINT measurement_value_finite CHECK (value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric));

CREATE FUNCTION reject_catalog_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published measurement definitions are immutable; add a new catalog version.' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER catalog_immutable BEFORE UPDATE OR DELETE ON measurement_catalogs
FOR EACH ROW EXECUTE FUNCTION reject_catalog_mutation();
CREATE TRIGGER definition_immutable BEFORE UPDATE OR DELETE ON measurement_definitions
FOR EACH ROW EXECUTE FUNCTION reject_catalog_mutation();

-- Serialize child writes on the parent to prevent two concurrent deletions
-- from each observing the other's last remaining item.
CREATE FUNCTION lock_measurement_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.measurement_id <> OLD.measurement_id THEN
    RAISE EXCEPTION 'Measurement items cannot move between records.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM measurements WHERE id = OLD.measurement_id FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM measurements WHERE id = NEW.measurement_id FOR UPDATE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER measurement_parent_lock BEFORE INSERT OR UPDATE OR DELETE ON measurement_items
FOR EACH ROW EXECUTE FUNCTION lock_measurement_parent();

-- Deferred validation allows an atomic parent + items write, and checks final
-- state after item replacement or changes to the record's age.
CREATE FUNCTION validate_measurement_record(record_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  record_age integer;
BEGIN
  SELECT age_at_measurement INTO record_age FROM measurements WHERE id = record_id;
  IF NOT FOUND THEN RETURN; END IF; -- Parent deletion cascades to items.

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
    )
  ) THEN
    RAISE EXCEPTION 'Measurement item violates its age, number format, or value bounds.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION check_measurement_record() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM validate_measurement_record(NEW.id);
  RETURN NULL;
END;
$$;

CREATE FUNCTION check_measurement_item() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM validate_measurement_record(OLD.measurement_id);
  ELSE
    PERFORM validate_measurement_record(NEW.measurement_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER measurement_record_valid AFTER INSERT OR UPDATE ON measurements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_measurement_record();
CREATE CONSTRAINT TRIGGER measurement_item_valid AFTER INSERT OR UPDATE OR DELETE ON measurement_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_measurement_item();

COMMIT;
