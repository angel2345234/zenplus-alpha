import { NextResponse } from 'next/server';
import pool from '@/lib/db';
export const dynamic = 'force-dynamic';
const stages = ['DRAFT','RESERVATION_HANDOFF','DOCUMENT_COLLECTION','CONTRACT_PENDING','SIGNING','SETTLED','CANCELLED'];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const body = await request.json();
    const { requirementCode, name, description = null, requiredForStage = null, isRequired = true, metadata = {} } = body;
    if (typeof requirementCode !== 'string' || !requirementCode.trim() || requirementCode.length > 80 || typeof name !== 'string' || !name.trim() || name.length > 180)
      return NextResponse.json({ success: false, error: 'INVALID_DOCUMENT_REQUIREMENT' }, { status: 400 });
    if (requiredForStage !== null && !stages.includes(requiredForStage)) return NextResponse.json({ success: false, error: 'INVALID_REQUIRED_STAGE' }, { status: 400 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return NextResponse.json({ success: false, error: 'METADATA_MUST_BE_OBJECT' }, { status: 400 });
    const result = await pool.query(
      `INSERT INTO operation.document_requirements (operation_id, requirement_code, name, description, required_for_stage, is_required, metadata)
       SELECT id, $2, $3, $4, $5, $6, $7::jsonb FROM operation.operations WHERE id = $1 RETURNING *`,
      [id, requirementCode.trim(), name.trim(), description, requiredForStage, Boolean(isRequired), JSON.stringify(metadata)]);
    if (!result.rowCount) return NextResponse.json({ success: false, error: 'OPERATION_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ success: false, error: error.code === '23505' ? 'DOCUMENT_REQUIREMENT_EXISTS' : (error.message || 'Error creando requisito') }, { status });
  }
}
