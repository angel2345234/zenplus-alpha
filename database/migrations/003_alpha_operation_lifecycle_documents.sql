-- Fase 3 / Alpha: ALP3-003, ALP3-004, ALP3-005
-- Additive migration: does not alter Publication Status or store document binaries.
BEGIN;
CREATE SCHEMA IF NOT EXISTS operation;

CREATE TABLE IF NOT EXISTS operation.operation_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES operation.operations(id) ON DELETE RESTRICT,
  from_stage operation.operation_stage,
  to_stage operation.operation_stage NOT NULL,
  changed_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_operation_stage_history_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_operation_stage_history_operation_time
  ON operation.operation_stage_history(operation_id, changed_at DESC);

-- Basic invariants for money/currency and primary-role cardinality.
DO $$ BEGIN
  ALTER TABLE operation.operations ADD CONSTRAINT ck_operation_agreed_amount_positive CHECK (agreed_amount > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE operation.operations ADD CONSTRAINT ck_operation_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE operation.operation_assets ADD CONSTRAINT ck_operation_asset_agreed_price_positive CHECK (agreed_price IS NULL OR agreed_price > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A single primary asset per operation; parking/storage are supplementary assets.
CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_single_primary_asset
  ON operation.operation_assets(operation_id) WHERE role = 'PRIMARY';
CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_primary_party_per_role
  ON operation.operation_parties(operation_id, role) WHERE is_primary = TRUE;

-- Keep the sale/rent participant role combinations valid at database level.
CREATE OR REPLACE FUNCTION operation.validate_operation_party_role()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op_type operation.operation_type;
BEGIN
  SELECT operation_type INTO op_type FROM operation.operations WHERE id = NEW.operation_id;
  IF op_type = 'SALE' AND NEW.role IN ('LESSOR', 'TENANT') THEN
    RAISE EXCEPTION 'LESSOR/TENANT roles are only valid for RENT operations'
      USING ERRCODE = '23514';
  ELSIF op_type = 'RENT' AND NEW.role IN ('BUYER', 'SELLER') THEN
    RAISE EXCEPTION 'BUYER/SELLER roles are only valid for SALE operations'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_operation_party_role ON operation.operation_parties;
CREATE TRIGGER trg_validate_operation_party_role
BEFORE INSERT OR UPDATE OF operation_id, role ON operation.operation_parties
FOR EACH ROW EXECUTE FUNCTION operation.validate_operation_party_role();

-- Preserve current state as the initial event for operations already in the database.
INSERT INTO operation.operation_stage_history(operation_id, from_stage, to_stage, changed_by, reason, changed_at)
SELECT id, NULL, stage, 'MIGRATION', 'Estado inicial registrado al habilitar el historico', created_at
FROM operation.operations o
WHERE NOT EXISTS (
  SELECT 1 FROM operation.operation_stage_history h WHERE h.operation_id = o.id
);

CREATE TABLE IF NOT EXISTS operation.asset_commercial_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL,
  unit_id UUID,
  commercial_status VARCHAR(30) NOT NULL,
  source_operation_id UUID REFERENCES operation.operations(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_asset_commercial_state_status CHECK (commercial_status IN
    ('AVAILABLE','RESERVED','UNDER_CONTRACT','SOLD','RENTED','REVIEW_REQUIRED')),
  CONSTRAINT ck_asset_commercial_state_identity CHECK (asset_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_commercial_state_asset_without_unit
  ON operation.asset_commercial_state(asset_id) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_commercial_state_asset_unit
  ON operation.asset_commercial_state(asset_id, unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_commercial_state_status
  ON operation.asset_commercial_state(commercial_status);
CREATE INDEX IF NOT EXISTS idx_asset_commercial_state_source_operation
  ON operation.asset_commercial_state(source_operation_id);

CREATE TABLE IF NOT EXISTS operation.document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES operation.operations(id) ON DELETE RESTRICT,
  requirement_code VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  required_for_stage operation.operation_stage,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_operation_document_requirement UNIQUE(operation_id, requirement_code),
  CONSTRAINT ck_document_requirement_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_document_requirements_operation_stage
  ON operation.document_requirements(operation_id, required_for_stage);

CREATE TABLE IF NOT EXISTS operation.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES operation.operations(id) ON DELETE RESTRICT,
  requirement_id UUID REFERENCES operation.document_requirements(id) ON DELETE RESTRICT,
  document_type VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_document_status CHECK (status IN ('PENDING','UPLOADED','UNDER_REVIEW','ACCEPTED','REJECTED','EXPIRED')),
  CONSTRAINT ck_document_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_documents_operation_status ON operation.documents(operation_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_requirement ON operation.documents(requirement_id);

CREATE TABLE IF NOT EXISTS operation.document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES operation.documents(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  storage_provider VARCHAR(40) NOT NULL,
  storage_key TEXT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 CHAR(64),
  uploaded_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_document_version UNIQUE(document_id, version_number),
  CONSTRAINT uq_document_storage_key UNIQUE(storage_provider, storage_key),
  CONSTRAINT ck_document_version_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ck_document_checksum CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-fA-F]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON operation.document_versions(document_id, version_number DESC);

-- Snapshot data must remain immutable after handoff.
CREATE OR REPLACE FUNCTION operation.reject_handoff_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot_data IS DISTINCT FROM OLD.snapshot_data
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
    RAISE EXCEPTION 'Reservation handoff snapshot and identifiers are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION operation.reject_handoff_snapshot_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reservation handoff snapshot cannot be deleted'
    USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_reservation_handoff_immutable ON operation.reservation_handoffs;
CREATE TRIGGER trg_reservation_handoff_immutable
BEFORE UPDATE ON operation.reservation_handoffs
FOR EACH ROW EXECUTE FUNCTION operation.reject_handoff_snapshot_mutation();
DROP TRIGGER IF EXISTS trg_reservation_handoff_no_delete ON operation.reservation_handoffs;
CREATE TRIGGER trg_reservation_handoff_no_delete
BEFORE DELETE ON operation.reservation_handoffs
FOR EACH ROW EXECUTE FUNCTION operation.reject_handoff_snapshot_delete();

COMMIT;
