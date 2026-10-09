-- ====================================================================
-- FASE 3 · CÉLULA ALPHA · SPRINT 1 (OPERATION FOUNDATION)
-- TICKET ALP3-001: Reservation -> Operation Handoff & Idempotency
-- TICKET ALP3-002: Operation, OperationParty & OperationAsset Model
-- ====================================================================

CREATE SCHEMA IF NOT EXISTS operation;

-- 1. TIPOS Y ENUMS DE OPERACIÓN
DO  BEGIN
    CREATE TYPE operation.operation_type AS ENUM ('SALE', 'RENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END ;

DO  BEGIN
    CREATE TYPE operation.operation_stage AS ENUM (
        'DRAFT',
        'RESERVATION_HANDOFF',
        'DOCUMENT_COLLECTION',
        'CONTRACT_PENDING',
        'SIGNING',
        'SETTLED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END ;

DO  BEGIN
    CREATE TYPE operation.party_role AS ENUM (
        'BUYER',
        'SELLER',
        'LESSOR',
        'TENANT',
        'ADVISOR',
        'LEGAL_REP'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END ;

DO  BEGIN
    CREATE TYPE operation.asset_role AS ENUM (
        'PRIMARY',
        'PARKING',
        'STORAGE',
        'SECONDARY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END ;

-- 2. TABLA PRINCIPAL DE OPERACIONES (ALP3-001 & ALP3-002)
CREATE TABLE IF NOT EXISTS operation.operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    operation_type operation.operation_type NOT NULL DEFAULT 'SALE',
    stage operation.operation_stage NOT NULL DEFAULT 'RESERVATION_HANDOFF',
    agreed_amount NUMERIC(14,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    reservation_id UUID UNIQUE, -- ALP3-001: Constraint UNIQUE garantiza idempotencia y evita duplicados
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. PARTICIPANTES DE LA OPERACIÓN (ALP3-002)
CREATE TABLE IF NOT EXISTS operation.operation_parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES operation.operations(id) ON DELETE CASCADE,
    party_id UUID NOT NULL,
    role operation.party_role NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_operation_party_role UNIQUE (operation_id, party_id, role)
);

-- 4. ACTIVOS VINCULADOS A LA OPERACIÓN (ALP3-002)
CREATE TABLE IF NOT EXISTS operation.operation_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES operation.operations(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL,
    unit_id UUID,
    role operation.asset_role NOT NULL DEFAULT 'PRIMARY',
    agreed_price NUMERIC(14,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_operation_asset UNIQUE (operation_id, asset_id)
);

-- 5. HISTORIAL Y SNAPSHOT DE HANDOFF DE RESERVA (ALP3-001)
CREATE TABLE IF NOT EXISTS operation.reservation_handoffs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL UNIQUE REFERENCES operation.operations(id) ON DELETE CASCADE,
    reservation_id UUID NOT NULL UNIQUE,
    snapshot_data JSONB NOT NULL,
    handed_off_by VARCHAR(100),
    handed_off_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. ÍNDICES DE RENDIMIENTO Y BÚSQUEDA
CREATE INDEX IF NOT EXISTS idx_operations_stage ON operation.operations (stage);
CREATE INDEX IF NOT EXISTS idx_operations_reservation ON operation.operations (reservation_id);
CREATE INDEX IF NOT EXISTS idx_operation_parties_party ON operation.operation_parties (party_id);
CREATE INDEX IF NOT EXISTS idx_operation_assets_asset ON operation.operation_assets (asset_id);
