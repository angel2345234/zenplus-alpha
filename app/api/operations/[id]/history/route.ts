import { NextResponse } from 'next/server';
import pool from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const exists = await pool.query('SELECT id FROM operation.operations WHERE id = $1', [id]);
    if (!exists.rowCount) return NextResponse.json({ success: false, error: 'OPERATION_NOT_FOUND' }, { status: 404 });
    const result = await pool.query(
      `SELECT id, operation_id AS "operationId", from_stage AS "fromStage", to_stage AS "toStage",
              changed_by AS "changedBy", reason, metadata, changed_at AS "changedAt"
       FROM operation.operation_stage_history WHERE operation_id = $1 ORDER BY changed_at ASC`, [id]);
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Error al consultar histórico' }, { status: 500 });
  }
}
