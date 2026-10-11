const sql = fs.readFileSync(
  path.join(__dirname, '003_alpha_operation_lifecycle_documents.sql'),
  'utf8'
);

const client = await pool.connect();

try {
  // Ejecutar la migración una sola vez.
  // El archivo SQL contiene su propio BEGIN/COMMIT.
  await client.query(sql);

  console.log('Migración ALP3-003/004/005 aplicada correctamente.');

  // Verificar que las tablas existan.
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
  console.error('No se pudo aplicar o verificar la migración:', error.message);
  process.exitCode = 1;
} finally {
  client.release();
}
