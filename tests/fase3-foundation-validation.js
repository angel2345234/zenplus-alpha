const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let passed = 0;
const tests = [];
function check(name, condition) { tests.push({ name, condition: Boolean(condition) }); }
const migration = fs.readFileSync(path.join(root, 'database/migrations/003_alpha_operation_lifecycle_documents.sql'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'apps/api/prisma/schema.prisma'), 'utf8');
const service = fs.readFileSync(path.join(root, 'apps/api/src/modules/operation/operation-foundation.service.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'apps/api/src/modules/operation/operation-foundation.routes.ts'), 'utf8');
const nextPatch = fs.readFileSync(path.join(root, 'app/api/operations/[id]/route.ts'), 'utf8');

check('ALP3-003: histórico de transiciones con origen/destino y actor', /CREATE TABLE IF NOT EXISTS operation\.operation_stage_history/.test(migration) && /from_stage/.test(migration) && /to_stage/.test(migration) && /operationStageHistory\.create/.test(service));
check('ALP3-003: transiciones validadas en servicio', /INVALID_OPERATION_STAGE_TRANSITION/.test(service) && /SETTLED: \[\]/.test(service) && /CANCELLED: \[\]/.test(service));
check('ALP3-004: proyección comercial separada de inventario', /CREATE TABLE IF NOT EXISTS operation\.asset_commercial_state/.test(migration) && /assetCommercialState/.test(service) && !/publication_status|publicationStatus/i.test(service));
check('ALP3-004: cancelación requiere conciliación en vez de liberar automáticamente', /REVIEW_REQUIRED/.test(service) && /another active operation may exist/.test(service));
check('ALP3-005: requisitos, documentos y versiones', /operation\.document_requirements/.test(migration) && /operation\.documents/.test(migration) && /operation\.document_versions/.test(migration) && /OperationDocumentVersion/.test(schema));
check('ALP3-005: versiones guardan referencia externa y no binarios', /storage_provider/.test(migration) && /storage_key/.test(migration) && !/bytea|blob_data|binary_content/i.test(migration));
check('Snapshots de handoff protegidos contra actualización y borrado', /trg_reservation_handoff_immutable/.test(migration) && /trg_reservation_handoff_no_delete/.test(migration));
check('Endpoints Fastify registrados para histórico y documentos', /operationFoundationRoutes/.test(routes) && /document-requirements/.test(routes) && /documents\/:documentId\/versions/.test(routes));
check('Next.js registra histórico, requisitos y versiones', fs.existsSync(path.join(root, 'app/api/operations/[id]/history/route.ts')) && fs.existsSync(path.join(root, 'app/api/operations/[id]/document-requirements/route.ts')) && fs.existsSync(path.join(root, 'app/api/operations/documents/[documentId]/versions/route.ts')) && /operation_stage_history/.test(nextPatch));

for (const test of tests) {
  console.log(`${test.condition ? 'PASS' : 'FAIL'} ${test.name}`);
  if (test.condition) passed++;
}
console.log(`\nFase 3 foundation: ${passed}/${tests.length} comprobaciones estáticas aprobadas.`);
if (passed !== tests.length) process.exit(1);
