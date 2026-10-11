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
    await client.query(sql); // migration contains its own BEGIN/COMMIT
    console.log('Migración ALP3-003/004/005 aplicada correctamente.');
  } catch (error) {
    console.error('No se pudo aplicar la migración:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
