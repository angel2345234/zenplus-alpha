import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const opQuery = `
      SELECT 
        o.id,
        o.code,
        o.operation_type AS "operationType",
        o.stage,
        o.agreed_amount AS "agreedAmount",
        o.currency,
        o.reservation_id AS "reservationId",
        o.notes,
        o.created_at AS "createdAt",
        o.updated_at AS "updatedAt",
        h.snapshot_data AS "snapshotData",
        h.handed_off_by AS "handedOffBy",
        h.handed_off_at AS "handedOffAt"
      FROM operation.operations o
      LEFT JOIN operation.reservation_handoffs h ON o.id = h.operation_id
      WHERE o.id = $1;
    `;
    const opRes = await pool.query(opQuery, [id]);

    if (opRes.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'OPERATION_NOT_FOUND', message: 'Operación no encontrada' },
        { status: 404 }
      );
    }

    const partiesRes = await pool.query(
      `SELECT id, party_id AS "partyId", role, is_primary AS "isPrimary", notes, created_at AS "createdAt"
       FROM operation.operation_parties WHERE operation_id = $1`,
      [id]
    );

    const assetsRes = await pool.query(
      `SELECT id, asset_id AS "assetId", unit_id AS "unitId", role, agreed_price AS "agreedPrice", created_at AS "createdAt"
       FROM operation.operation_assets WHERE operation_id = $1`,
      [id]
    );

    return NextResponse.json({
      success: true,
      data: {
        ...opRes.rows[0],
        parties: partiesRes.rows,
        assets: assetsRes.rows,
      },
    });
  } catch (error: any) {
    console.error('Error al obtener operación:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error al obtener operación' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { stage, notes } = body;

    if (!stage) {
      return NextResponse.json(
        { success: false, error: 'Parámetro obligatorio: stage' },
        { status: 400 }
      );
    }

    const updateRes = await pool.query(
      `UPDATE operation.operations 
       SET stage = $1, 
           notes = COALESCE($2, notes), 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3 
       RETURNING *`,
      [stage, notes || null, id]
    );

    if (updateRes.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: 'OPERATION_NOT_FOUND', message: 'Operación no encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updateRes.rows[0],
    });
  } catch (error: any) {
    console.error('Error al actualizar etapa de operación:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error al actualizar etapa de operación' },
      { status: 500 }
    );
  }
}
