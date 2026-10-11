const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está definido. Configura el .env en la raíz del repositorio.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '003_alpha_operation_lifecycle_documents.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);

    const result = await client.query(`
  SELECT
    current_database() AS database_name,
    current_schema() AS schema_name,
    to_regclass('operation.operation_stage_history') AS stage_history,
    to_regclass('operation.document_requirements') AS document_requirements,
    to_regclass('operation.documents') AS documents,
    to_regclass('operation.document_versions') AS document_versions
`);

    console.table(result.rows);

    const row = result.rows[0];

    const missing = [
      'stage_history',
      'document_requirements',
      'documents',
      'document_versions'
    ].filter((key) => row[key] === null);

    if (missing.length > 0) {
      throw new Error(
        `Migración incompleta. Tablas faltantes: ${missing.join(', ')}`
      );
    }

    console.log('Migración ALP3-003/004/005 verificada correctamente.');
  } catch (error) {
    console.error('No se pudo aplicar la migración:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
