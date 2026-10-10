const { Pool } = require('pg');
require('dotenv').config({ path: 'C:/Users/LOQ/Documents/Zenplus/zenplus-alpha/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('--- Aplicando migración de Fase 3 en Neon DB ---');
    await client.query('BEGIN');

    await client.query('CREATE SCHEMA IF NOT EXISTS operation;');

    // 1. Tipos ENUM
    const enumQueries = [
      "CREATE TYPE operation.operation_type AS ENUM ('SALE', 'RENT');",
      "CREATE TYPE operation.operation_stage AS ENUM ('DRAFT', 'RESERVATION_HANDOFF', 'DOCUMENT_COLLECTION', 'CONTRACT_PENDING', 'SIGNING', 'SETTLED', 'CANCELLED');",
      "CREATE TYPE operation.party_role AS ENUM ('BUYER', 'SELLER', 'LESSOR', 'TENANT', 'ADVISOR', 'LEGAL_REP');",
      "CREATE TYPE operation.asset_role AS ENUM ('PRIMARY', 'PARKING', 'STORAGE', 'SECONDARY');"
    ];

    for (const q of enumQueries) {
      try {
        await client.query(q);
      } catch (err) {
        if (err.code !== '42710') { // 42710 = duplicate_object
          console.warn('Enum warning:', err.message);
        }
      }
    }
    console.log('✔ Enums creados o verificados.');

    // 2. Tablas
    await client.query(`
      CREATE TABLE IF NOT EXISTS operation.operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) UNIQUE NOT NULL,
        operation_type operation.operation_type NOT NULL DEFAULT 'SALE',
        stage operation.operation_stage NOT NULL DEFAULT 'RESERVATION_HANDOFF',
        agreed_amount NUMERIC(14,2) NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        reservation_id UUID UNIQUE,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✔ Tabla operation.operations creada.');

    await client.query(`
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
    `);
    console.log('✔ Tabla operation.operation_parties creada.');

    await client.query(`
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
    `);
    console.log('✔ Tabla operation.operation_assets creada.');

    await client.query(`
      CREATE TABLE IF NOT EXISTS operation.reservation_handoffs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        operation_id UUID NOT NULL UNIQUE REFERENCES operation.operations(id) ON DELETE CASCADE,
        reservation_id UUID NOT NULL UNIQUE,
        snapshot_data JSONB NOT NULL,
        handed_off_by VARCHAR(100),
        handed_off_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✔ Tabla operation.reservation_handoffs creada.');

    // 3. Índices
    await client.query('CREATE INDEX IF NOT EXISTS idx_operations_stage ON operation.operations (stage);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_operations_reservation ON operation.operations (reservation_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_operation_parties_party ON operation.operation_parties (party_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_operation_assets_asset ON operation.operation_assets (asset_id);');
    console.log('✔ Índices creados.');

    await client.query('COMMIT');
    console.log('🎉 Migración de Fase 3 completada con éxito en Neon DB!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error aplicando migración:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
