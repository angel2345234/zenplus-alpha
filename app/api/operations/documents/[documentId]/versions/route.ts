import { NextResponse } from 'next/server';
import pool from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const client = await pool.connect();
  try {
    const { documentId } = await params; const body = await request.json();
    const { storageProvider, storageKey, originalFilename, mimeType, sizeBytes, checksumSha256 = null, uploadedBy = 'SYSTEM', metadata = {} } = body;
    if (typeof storageProvider !== 'string' || !storageProvider.trim() || storageProvider.length > 40 || typeof storageKey !== 'string' || !storageKey.trim() || typeof originalFilename !== 'string' || !originalFilename.trim() || originalFilename.length > 255 || typeof mimeType !== 'string' || !mimeType.trim() || mimeType.length > 150 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
      return NextResponse.json({ success: false, error: 'INVALID_DOCUMENT_VERSION_METADATA' }, { status: 400 });
    if (checksumSha256 !== null && !/^[a-fA-F0-9]{64}$/.test(checksumSha256)) return NextResponse.json({ success: false, error: 'INVALID_SHA256_CHECKSUM' }, { status: 400 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return NextResponse.json({ success: false, error: 'METADATA_MUST_BE_OBJECT' }, { status: 400 });
    await client.query('BEGIN');
    const doc = await client.query('SELECT id, current_version FROM operation.documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (!doc.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ success: false, error: 'DOCUMENT_NOT_FOUND' }, { status: 404 }); }
    const versionNumber = doc.rows[0].current_version + 1;
    const result = await client.query(
      `INSERT INTO operation.document_versions (document_id, version_number, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum_sha256, uploaded_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
      [documentId, versionNumber, storageProvider.trim(), storageKey.trim(), originalFilename.trim(), mimeType.trim(), sizeBytes, checksumSha256, String(uploadedBy).slice(0,100), JSON.stringify(metadata)]);
    await client.query(`UPDATE operation.documents SET current_version = $2, status = 'UPLOADED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [documentId, versionNumber]);
    await client.query('COMMIT');
    return NextResponse.json({ success: true, data: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json({ success: false, error: error.code === '23505' ? 'DOCUMENT_VERSION_CONFLICT' : (error.message || 'Error registrando versión') }, { status });
  } finally { client.release(); }
}
