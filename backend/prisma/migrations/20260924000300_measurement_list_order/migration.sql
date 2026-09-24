-- Match latest-polygon selection and the new list cursor order. Keep the
-- existing index for cursor chains issued before this ordering change.
CREATE INDEX "measurements_latest_idx"
ON "measurements" ("user_id", "measured_on" DESC, "created_at" DESC, "id");
