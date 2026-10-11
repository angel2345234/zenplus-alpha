# Alpha Fase 3 — ALP3-003, ALP3-004 y ALP3-005

## ALP3-003 — Máquina de estados e histórico

- Se formalizan transiciones permitidas: `DRAFT → RESERVATION_HANDOFF → DOCUMENT_COLLECTION → CONTRACT_PENDING → SIGNING → SETTLED`; desde las etapas no terminales se permite `CANCELLED` según el mapa del servicio.
- `SETTLED` y `CANCELLED` son terminales.
- Cada cambio permitido actualiza la operación y registra `from_stage`, `to_stage`, `changed_by`, motivo, metadatos y fecha dentro de la misma transacción.
- Se registra el estado existente de las operaciones como evento inicial al aplicar la migración.

## ALP3-004 — Proyección comercial

- La disponibilidad comercial se mantiene en `operation.asset_commercial_state`, separada de `inventory.assets.status` y de `Publication Status`.
- Handoff/colección documental proyectan `RESERVED`; contrato/firma proyectan `UNDER_CONTRACT`; cierre proyecta `SOLD` o `RENTED` según el tipo.
- Cancelación proyecta `REVIEW_REQUIRED`; no libera automáticamente el activo, porque puede haber otra operación activa que requiera conciliación.

## ALP3-005 — Documentos

- `document_requirements`: requisito por operación, código único, etapa, obligatoriedad y metadatos JSON.
- `documents`: tipo, título, estado, relación opcional con un requisito y versión vigente.
- `document_versions`: versión, proveedor/ubicación externa, nombre original, MIME, tamaño, SHA-256 y auditoría.
- Los binarios no se guardan en PostgreSQL; `storage_provider` y `storage_key` apuntan al almacenamiento externo.

## Rutas añadidas

Fastify:
- `GET /operations/:id/history`
- `POST /operations/:id/document-requirements`
- `POST /operations/:id/documents`
- `POST /operations/documents/:documentId/versions`
- `PATCH /operations/:id/stage` existente, ahora usa la máquina de estados.

Next.js:
- `GET /api/operations/:id/history`
- `POST /api/operations/:id/document-requirements`
- `POST /api/operations/:id/documents`
- `POST /api/operations/documents/:documentId/versions`
- `PATCH /api/operations/:id` ahora valida transición, guarda histórico y actualiza solo la proyección comercial.

## Validación pendiente en el entorno

La suite `npm run test:fase3:foundation` valida estáticamente las nuevas piezas. Antes de producción, aplicar la migración en una base de pruebas, regenerar Prisma Client y ejecutar build, pruebas de integración, concurrencia e idempotencia con `DATABASE_URL` de test. No se ejecutó ni se modificó directamente la base Neon desde este trabajo.
