import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST: ALP3-001 - Handoff de Reserva a Operación (Idempotente 1:1 con Snapshot Inmutable)
export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      reservationId,
      operationType = 'SALE',
      agreedAmount,
      currency = 'USD',
      handedOffBy = 'SYSTEM',
      snapshotData = {},
      parties = [],
      assets = [],
      notes,
    } = body;

    if (!reservationId || !agreedAmount) {
      return NextResponse.json(
        { success: false, error: 'Parámetros obligatorios faltantes: reservationId y agreedAmount' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // 1. Verificación de Idempotencia Estricta 1:1 (ALP3-001)
    const checkOp = await client.query(
      `SELECT id, code, stage FROM operation.operations WHERE reservation_id = $1`,
      [reservationId]
    );

    if (checkOp.rowCount && checkOp.rowCount > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          success: false,
          error: 'OPERATION_ALREADY_EXISTS_FOR_RESERVATION',
          message: `Ya existe una operación registrada para la reserva ${reservationId}`,
          existing: checkOp.rows[0],
        },
        { status: 409 }
      );
    }

    // 2. Generación de código único
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    const code = `OP-${year}-${rand}`;

    // 3. Creación de la Operación (ALP3-001 / ALP3-002)
    const opInsert = await client.query(
      `INSERT INTO operation.operations 
       (code, operation_type, stage, agreed_amount, currency, reservation_id, notes)
       VALUES ($1, $2, 'RESERVATION_HANDOFF', $3, $4, $5, $6)
       RETURNING *`,
      [code, operationType, agreedAmount, currency, reservationId, notes || null]
    );
    const operation = opInsert.rows[0];

    // 4. Captura inmutable de Snapshot (ALP3-001)
    const snapshot = {
      ...snapshotData,
      _snapshotMetadata: {
        reservationId,
        capturedAt: new Date().toISOString(),
        handedOffBy,
        agreedAmount,
        currency,
      },
    };

    await client.query(
      `INSERT INTO operation.reservation_handoffs 
       (operation_id, reservation_id, snapshot_data, handed_off_by)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [operation.id, reservationId, JSON.stringify(snapshot), handedOffBy]
    );

    // 5. Inserción de participantes (ALP3-002)
    const insertedParties = [];
    for (const p of parties) {
      const pRes = await client.query(
        `INSERT INTO operation.operation_parties 
         (operation_id, party_id, role, is_primary, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [operation.id, p.partyId, p.role, p.isPrimary ?? false, p.notes || null]
      );
      insertedParties.push(pRes.rows[0]);
    }

    // 6. Inserción de activos (ALP3-002)
    const insertedAssets = [];
    for (const a of assets) {
      const aRes = await client.query(
        `INSERT INTO operation.operation_assets 
         (operation_id, asset_id, unit_id, role, agreed_price)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [operation.id, a.assetId, a.unitId || null, a.role || 'PRIMARY', a.agreedPrice || null]
      );
      insertedAssets.push(aRes.rows[0]);
    }

    // 7. Registro de Evento de Dominio (Outbox)
    await client.query(
      `INSERT INTO public.inventory_domain_events (event_type, aggregate_type, aggregate_id, payload)
       VALUES ('operation_created', 'OPERATION', $1, $2::jsonb)`,
      [operation.id, JSON.stringify({ operationId: operation.id, code, reservationId, agreedAmount })]
    );

    await client.query('COMMIT');

    return NextResponse.json(
      {
        success: true,
        data: {
          ...operation,
          parties: insertedParties,
          assets: insertedAssets,
          snapshot,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error en handoff a operación:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error interno al procesar el handoff' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
