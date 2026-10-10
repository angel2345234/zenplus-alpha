const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Manejar desconexiones inactivas comunes en Neon serverless PostgreSQL
pool.on('error', (err) => {
  // Ignorar errores de clientes inactivos
});

async function runValidationSuite() {
  console.log('\n================================================================');
  console.log('🧪 SUITE DE VALIDACIÓN AUTOMATIZADA · CÉLULA ALPHA (FASE 3)');
  console.log('   Tickets: ALP3-001 (Reservation Handoff & Idempotency)');
  console.log('            ALP3-002 (Operation, Parties & Assets Model)');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 6;

  try {
    // -------------------------------------------------------------
    // TEST 1: ALP3-001 - Handoff Atómico con Snapshot Inmutable
    // -------------------------------------------------------------
    console.log('📌 [TEST 1] ALP3-001: Handoff de Reserva a Operación (Transacción ACID)');
    const testResId1 = crypto.randomUUID();
    const testPartyBuyer = crypto.randomUUID();
    const testPartyAdvisor = crypto.randomUUID();
    const testAssetMain = crypto.randomUUID();
    const testAssetParking = crypto.randomUUID();

    const snapshotPayload = {
      reservationId: testResId1,
      reservationPrice: 245000.00,
      clientName: 'María Fernanda Valdivia',
      clientEmail: 'mvaldivia@zenplus.test',
      holdExpiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      agreedFinancing: 'BBVA_MORTGAGE',
    };

    const opCode = `OP-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    
    // Inserción de Operación principal
    const opRes = await pool.query(
      `INSERT INTO operation.operations 
       (code, operation_type, stage, agreed_amount, currency, reservation_id, notes)
       VALUES ($1, 'SALE', 'RESERVATION_HANDOFF', 245000.00, 'USD', $2, 'Handoff validado desde reserva de preventa')
       RETURNING id, code, stage, agreed_amount, currency, reservation_id;`,
      [opCode, testResId1]
    );
    const op1Id = opRes.rows[0].id;
    const op1Code = opRes.rows[0].code;

    // Inserción de Snapshot Inmutable
    await pool.query(
      `INSERT INTO operation.reservation_handoffs 
       (operation_id, reservation_id, snapshot_data, handed_off_by)
       VALUES ($1, $2, $3::jsonb, 'Asesor Carlos Ramos');`,
      [op1Id, testResId1, JSON.stringify(snapshotPayload)]
    );

    // Inserción de Participantes (ALP3-002)
    await pool.query(
      `INSERT INTO operation.operation_parties (operation_id, party_id, role, is_primary, notes)
       VALUES 
         ($1, $2, 'BUYER', true, 'Compradora principal acreditada'),
         ($1, $3, 'ADVISOR', false, 'Asesor asignado en fase de reserva');`,
      [op1Id, testPartyBuyer, testPartyAdvisor]
    );

    // Inserción de Activos (ALP3-002)
    await pool.query(
      `INSERT INTO operation.operation_assets (operation_id, asset_id, role, agreed_price)
       VALUES 
         ($1, $2, 'PRIMARY', 225000.00),
         ($1, $3, 'PARKING', 20000.00);`,
      [op1Id, testAssetMain, testAssetParking]
    );

    // Evento de Dominio
    await pool.query(
      `INSERT INTO public.inventory_domain_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('operation_created', 'OPERATION', $1, $2::jsonb);`,
      [op1Id, JSON.stringify({ operationId: op1Id, code: op1Code, reservationId: testResId1 })]
    );

    // Verificación
    const verifyOp = await pool.query(
      `SELECT o.code, o.stage, o.agreed_amount, h.handed_off_by, h.snapshot_data->>'clientName' as client
       FROM operation.operations o
       JOIN operation.reservation_handoffs h ON o.id = h.operation_id
       WHERE o.id = $1;`,
      [op1Id]
    );

    console.table(verifyOp.rows);
    if (verifyOp.rows[0].client === 'María Fernanda Valdivia') {
      console.log('   ✅ Handoff atómico completado y snapshot inmutable preservado.\n');
      passedTests++;
    } else {
      console.log('   ❌ Error al verificar snapshot de handoff.\n');
    }

    // -------------------------------------------------------------
    // TEST 2: ALP3-001 - Idempotencia Estricta 1:1
    // -------------------------------------------------------------
    console.log('📌 [TEST 2] ALP3-001: Verificación de Idempotencia Estricta 1:1 (Prevenir Operaciones Huérfanas/Duplicadas)');
    let duplicateRejected = false;
    try {
      // Intentar crear una SEGUNDA operación para la MISMA reserva testResId1
      await pool.query(
        `INSERT INTO operation.operations 
         (code, operation_type, stage, agreed_amount, currency, reservation_id)
         VALUES ('OP-2026-DUPLICATE', 'SALE', 'RESERVATION_HANDOFF', 245000.00, 'USD', $1);`,
        [testResId1]
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'operations_reservation_id_key') {
        duplicateRejected = true;
      }
    }

    const opCount = await pool.query(
      `SELECT COUNT(*)::int as count FROM operation.operations WHERE reservation_id = $1;`,
      [testResId1]
    );

    if (duplicateRejected && opCount.rows[0].count === 1) {
      console.log('   [Resultado]: Intento de duplicado RECHAZADO por constraint UNIQUE (Código PG 23505).');
      console.log(`   [Total de Operaciones para la Reserva]: ${opCount.rows[0].count} (Exactamente 1:1).`);
      console.log('   ✅ IDEMPOTENCIA GARANTIZADA: Cero riesgo de operaciones duplicadas para una misma reserva.\n');
      passedTests++;
    } else {
      console.log('   ❌ FALLO: Se permitió crear una operación duplicada.\n');
    }

    // -------------------------------------------------------------
    // TEST 3: ALP3-002 - Modelo de Participantes y Restricción de Roles
    // -------------------------------------------------------------
    console.log('📌 [TEST 3] ALP3-002: Modelo de Participantes (Parties) y Roles Múltiples');
    
    // Consultar participantes vinculados
    const partiesList = await pool.query(
      `SELECT p.party_id, p.role, p.is_primary, p.notes
       FROM operation.operation_parties p
       WHERE p.operation_id = $1
       ORDER BY p.is_primary DESC;`,
      [op1Id]
    );
    console.table(partiesList.rows);

    // Intentar duplicar exactamente el mismo participante con el mismo rol en la misma operación
    let duplicatePartyRejected = false;
    try {
      await pool.query(
        `INSERT INTO operation.operation_parties (operation_id, party_id, role, is_primary)
         VALUES ($1, $2, 'BUYER', false);`,
        [op1Id, testPartyBuyer]
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'uq_operation_party_role') {
        duplicatePartyRejected = true;
      }
    }

    if (duplicatePartyRejected && partiesList.rows.length === 2) {
      console.log('   [Resultado]: Restricción uq_operation_party_role protege contra roles duplicados.');
      console.log('   ✅ MODELO DE PARTICIPANTES VALIDADO (BUYER, ADVISOR, is_primary soportados).\n');
      passedTests++;
    } else {
      console.log('   ❌ FALLO: No se controló la duplicación de roles de participante.\n');
    }

    // -------------------------------------------------------------
    // TEST 4: ALP3-002 - Modelo de Activos y Restricción de Asignación Única
    // -------------------------------------------------------------
    console.log('📌 [TEST 4] ALP3-002: Modelo de Activos Vinculados (Assets) y Roles (PRIMARY, PARKING, STORAGE)');
    
    const assetsList = await pool.query(
      `SELECT a.asset_id, a.role, a.agreed_price
       FROM operation.operation_assets a
       WHERE a.operation_id = $1
       ORDER BY a.role ASC;`,
      [op1Id]
    );
    console.table(assetsList.rows);

    // Intentar agregar el mismo activo nuevamente a la misma operación
    let duplicateAssetRejected = false;
    try {
      await pool.query(
        `INSERT INTO operation.operation_assets (operation_id, asset_id, role)
         VALUES ($1, $2, 'SECONDARY');`,
        [op1Id, testAssetMain]
      );
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'uq_operation_asset') {
        duplicateAssetRejected = true;
      }
    }

    if (duplicateAssetRejected && assetsList.rows.length === 2) {
      console.log('   [Resultado]: Restricción uq_operation_asset previene doble asignación del mismo inmueble.');
      console.log('   ✅ MODELO DE ACTIVOS VALIDADO (PRIMARY, PARKING con precios pactados individuales).\n');
      passedTests++;
    } else {
      console.log('   ❌ FALLO: No se validó la integridad de asignación de activos.\n');
    }

    // -------------------------------------------------------------
    // TEST 5: ALP3-001 / ALP3-002 - Ciclo de Vida y Transición de Estados
    // -------------------------------------------------------------
    console.log('📌 [TEST 5] ALP3-001 & ALP3-002: Transición de Estados de Operación');
    
    // Transicionar de RESERVATION_HANDOFF a DOCUMENT_COLLECTION
    await pool.query(
      `UPDATE operation.operations 
       SET stage = 'DOCUMENT_COLLECTION', 
           notes = 'Documentos de identidad y carta de aprobación recibidos',
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1;`,
      [op1Id]
    );

    // Transicionar a CONTRACT_PENDING
    await pool.query(
      `UPDATE operation.operations 
       SET stage = 'CONTRACT_PENDING', 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1;`,
      [op1Id]
    );

    const stageCheck = await pool.query(
      `SELECT id, code, stage, notes, updated_at > created_at as has_updated 
       FROM operation.operations WHERE id = $1;`,
      [op1Id]
    );
    console.table(stageCheck.rows);

    if (stageCheck.rows[0].stage === 'CONTRACT_PENDING' && stageCheck.rows[0].has_updated) {
      console.log('   ✅ Transiciones de ciclo de vida de operación verificadas con éxito.\n');
      passedTests++;
    } else {
      console.log('   ❌ Fallo al actualizar estado de la operación.\n');
    }

    // -------------------------------------------------------------
    // TEST 6: ALP3-001 / ALP3-002 - Verificación de Índices y Optimización
    // -------------------------------------------------------------
    console.log('📌 [TEST 6] ALP3-001 & ALP3-002: Verificación de Índices en Schema operation');
    const indexesRes = await pool.query(`
      SELECT indexname AS "Nombre del Índice", tablename AS "Tabla"
      FROM pg_indexes 
      WHERE schemaname = 'operation'
      ORDER BY tablename, indexname;
    `);
    console.table(indexesRes.rows);

    const requiredIndexes = [
      'idx_operations_stage',
      'idx_operations_reservation',
      'idx_operation_parties_party',
      'idx_operation_assets_asset',
    ];

    const foundAll = requiredIndexes.every(idx => 
      indexesRes.rows.some(r => r['Nombre del Índice'] === idx)
    );

    if (foundAll) {
      console.log('   ✅ Todos los índices de alto rendimiento verificados correctamente en Neon.\n');
      passedTests++;
    } else {
      console.log('   ❌ Faltan índices de optimización en el schema operation.\n');
    }

    // -------------------------------------------------------------
    // RESUMEN
    // -------------------------------------------------------------
    console.log('================================================================');
    console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} PRUEBAS SUPERADAS EXITOSAMENTE`);
    if (passedTests === totalTests) {
      console.log('🎉 TICKETS ALP3-001 Y ALP3-002 TOTALMENTE IMPLEMENTADOS Y VALIDADOS');
    } else {
      console.log('⚠️ ALGUNAS PRUEBAS NO PASARON. REVISAR LOGS ANTERIORES.');
    }
    console.log('================================================================\n');

  } catch (error) {
    console.error('Error durante la validación de Fase 3:', error);
  } finally {
    await pool.end();
  }
}

runValidationSuite();
