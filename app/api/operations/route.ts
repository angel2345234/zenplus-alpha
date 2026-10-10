import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET: Listado de operaciones con filtros por stage y tipo (ALP3-002)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const conditions: string[] = ['1=1'];
    const values: unknown[] = [];
    let pIdx = 1;

    if (stage) {
      conditions.push(`o.stage = $${pIdx}`);
      values.push(stage);
      pIdx++;
    }

    if (type) {
      conditions.push(`o.operation_type = $${pIdx}`);
      values.push(type);
      pIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*)::int as total FROM operation.operations o WHERE ${whereClause}`;
    const countRes = await pool.query(countQuery, values);
    const total = countRes.rows[0].total;

    values.push(limit);
    const limitIdx = pIdx++;
    values.push(offset);
    const offsetIdx = pIdx++;

    const listQuery = `
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
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', p.id,
            'partyId', p.party_id,
            'role', p.role,
            'isPrimary', p.is_primary
          )) FILTER (WHERE p.id IS NOT NULL), '[]'
        ) AS parties,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', a.id,
            'assetId', a.asset_id,
            'unitId', a.unit_id,
            'role', a.role,
            'agreedPrice', a.agreed_price
          )) FILTER (WHERE a.id IS NOT NULL), '[]'
        ) AS assets
      FROM operation.operations o
      LEFT JOIN operation.operation_parties p ON o.id = p.operation_id
      LEFT JOIN operation.operation_assets a ON o.id = a.operation_id
      WHERE ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const listRes = await pool.query(listQuery, values);

    return NextResponse.json({
      success: true,
      total,
      limit,
      offset,
      data: listRes.rows,
    });
  } catch (error: any) {
    console.error('Error al consultar operaciones:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error al consultar operaciones' },
      { status: 500 }
    );
  }
}
