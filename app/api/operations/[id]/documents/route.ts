import { NextResponse } from 'next/server';
import pool from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const body = await request.json();
    const { requirementId = null, documentType, title, createdBy = 'SYSTEM', metadata = {} } = body;
    if (typeof documentType !== 'string' || !documentType.trim() || documentType.length > 80 || typeof title !== 'string' || !title.trim() || title.length > 180)
      return NextResponse.json({ success: false, error: 'INVALID_DOCUMENT' }, { status: 400 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return NextResponse.json({ success: false, error: 'METADATA_MUST_BE_OBJECT' }, { status: 400 });
    if (requirementId) {
      const requirement = await pool.query('SELECT id FROM operation.document_requirements WHERE id = $1 AND operation_id = $2', [requirementId, id]);
      if (!requirement.rowCount) return NextResponse.json({ success: false, error: 'DOCUMENT_REQUIREMENT_OPERATION_MISMATCH' }, { status: 409 });
    }
    const result = await pool.query(
      `INSERT INTO operation.documents (operation_id, requirement_id, document_type, title, created_by, metadata)
       SELECT id, $2, $3, $4, $5, $6::jsonb FROM operation.operations WHERE id = $1 RETURNING *`,
      [id, requirementId, documentType.trim(), title.trim(), String(createdBy).slice(0,100), JSON.stringify(metadata)]);
    if (!result.rowCount) return NextResponse.json({ success: false, error: 'OPERATION_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || 'Error creando documento' }, { status: 500 });
  }
}
