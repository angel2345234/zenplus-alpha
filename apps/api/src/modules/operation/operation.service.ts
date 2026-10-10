import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { track } from "../../lib/analytics";
import type {
  HandoffReservationInput,
  CreateOperationPartyInput,
  CreateOperationAssetInput,
  OperationStage,
  OperationType,
  ListOperationsQuery,
} from "./operation.schema";

export class ConflictError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, any>;

  constructor(message: string, code: string, details?: Record<string, any>) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
    this.statusCode = 409;
    this.details = details;
  }
}

export class NotFoundError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string) {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
    this.statusCode = 404;
  }
}

function generateOperationCode(): string {
  const year = new Date().getFullYear();
  const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `OP-${year}-${randomPart}`;
}

/**
 * ALP3-001: Reservation -> Operation handoff
 * Con idempotencia estricta 1:1, captura de snapshot inmutable y creación atómica.
 */
export async function handoffReservationToOperation(input: HandoffReservationInput) {
  // 1. Verificación de Idempotencia Estricta (ALP3-001)
  const existing = await prisma.operation.findUnique({
    where: { reservationId: input.reservationId },
    include: { parties: true, assets: true, handoff: true },
  });

  if (existing) {
    logger.warn(
      { reservationId: input.reservationId, existingOperationId: existing.id },
      "Intento de handoff duplicado para la misma reserva"
    );
    throw new ConflictError(
      `Ya existe una operación registrada para la reserva ${input.reservationId}`,
      "OPERATION_ALREADY_EXISTS_FOR_RESERVATION",
      {
        operationId: existing.id,
        operationCode: existing.code,
        stage: existing.stage,
      }
    );
  }

  // 2. Snapshot Inmutable
  const snapshot = {
    ...input.snapshotData,
    _snapshotMetadata: {
      reservationId: input.reservationId,
      capturedAt: new Date().toISOString(),
      handedOffBy: input.handedOffBy ?? "SYSTEM",
      agreedAmount: input.agreedAmount,
      currency: input.currency ?? "USD",
    },
  };

  const code = generateOperationCode();

  // 3. Transacción Atómica ACID (ALP3-001 & ALP3-002)
  const createdOperation = await prisma.$transaction(async (tx) => {
    // a. Crear Operación principal
    const operation = await tx.operation.create({
      data: {
        code,
        operationType: input.operationType ?? "SALE",
        stage: "RESERVATION_HANDOFF",
        agreedAmount: input.agreedAmount,
        currency: input.currency ?? "USD",
        reservationId: input.reservationId,
        notes: input.notes ?? null,
      },
    });

    // b. Crear Registro de Handoff con Snapshot inmutable
    await tx.reservationHandoff.create({
      data: {
        operationId: operation.id,
        reservationId: input.reservationId,
        snapshotData: snapshot,
        handedOffBy: input.handedOffBy ?? null,
      },
    });

    // c. Vincular Participantes si fueron provistos (ALP3-002)
    if (input.parties && input.parties.length > 0) {
      for (const p of input.parties) {
        await tx.operationParty.create({
          data: {
            operationId: operation.id,
            partyId: p.partyId,
            role: p.role,
            isPrimary: p.isPrimary ?? false,
            notes: p.notes ?? null,
          },
        });
      }
    }

    // d. Vincular Activos si fueron provistos (ALP3-002)
    if (input.assets && input.assets.length > 0) {
      for (const a of input.assets) {
        await tx.operationAsset.create({
          data: {
            operationId: operation.id,
            assetId: a.assetId,
            unitId: a.unitId ?? null,
            role: a.role ?? "PRIMARY",
            agreedPrice: a.agreedPrice ?? null,
          },
        });
      }
    }

    return operation;
  });

  // 4. Emitir Eventos de Dominio y Métricas
  logger.info(
    {
      operationId: createdOperation.id,
      code: createdOperation.code,
      reservationId: input.reservationId,
    },
    "Operación creada exitosamente vía handoff de reserva"
  );

  track("operation_created", {
    operationId: createdOperation.id,
    code: createdOperation.code,
    reservationId: input.reservationId,
    operationType: createdOperation.operationType,
  });

  track("reservation_handed_off", {
    operationId: createdOperation.id,
    reservationId: input.reservationId,
    handedOffBy: input.handedOffBy,
  });

  // 5. Retornar operación completa con relaciones
  return getOperationById(createdOperation.id);
}

/**
 * Consulta de operación por ID con participantes, activos y snapshot
 */
export async function getOperationById(id: string) {
  const operation = await prisma.operation.findUnique({
    where: { id },
    include: {
      parties: true,
      assets: true,
      handoff: true,
    },
  });

  if (!operation) {
    throw new NotFoundError(`Operación con ID ${id} no encontrada`, "OPERATION_NOT_FOUND");
  }

  return operation;
}

/**
 * Consulta de operación por reservationId
 */
export async function getOperationByReservationId(reservationId: string) {
  const operation = await prisma.operation.findUnique({
    where: { reservationId },
    include: {
      parties: true,
      assets: true,
      handoff: true,
    },
  });

  if (!operation) {
    throw new NotFoundError(
      `Operación para la reserva ${reservationId} no encontrada`,
      "OPERATION_NOT_FOUND"
    );
  }

  return operation;
}

/**
 * Listado de operaciones con filtros y paginación
 */
export async function listOperations(query: ListOperationsQuery) {
  const where: any = {};
  if (query.stage) where.stage = query.stage;
  if (query.operationType) where.operationType = query.operationType;

  const [total, data] = await Promise.all([
    prisma.operation.count({ where }),
    prisma.operation.findMany({
      where,
      take: query.limit,
      skip: query.offset,
      orderBy: { createdAt: "desc" },
      include: {
        parties: true,
        assets: true,
      },
    }),
  ]);

  return { total, data, limit: query.limit, offset: query.offset };
}

/**
 * Actualizar etapa de la operación
 */
export async function updateOperationStage(
  id: string,
  stage: OperationStage,
  notes?: string
) {
  const existing = await prisma.operation.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError(`Operación con ID ${id} no encontrada`, "OPERATION_NOT_FOUND");
  }

  const updated = await prisma.operation.update({
    where: { id },
    data: {
      stage,
      notes: notes ?? existing.notes,
    },
    include: {
      parties: true,
      assets: true,
      handoff: true,
    },
  });

  logger.info({ operationId: id, from: existing.stage, to: stage }, "Operation stage updated");
  track("operation_stage_changed", {
    operationId: id,
    previousStage: existing.stage,
    newStage: stage,
  });

  return updated;
}

/**
 * ALP3-002: Agregar participante a una operación
 */
export async function addPartyToOperation(
  operationId: string,
  input: CreateOperationPartyInput
) {
  const op = await prisma.operation.findUnique({ where: { id: operationId } });
  if (!op) {
    throw new NotFoundError(`Operación con ID ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
  }

  // Prevenir duplicado de rol para el mismo participante en la operación
  const existingPartyRole = await prisma.operationParty.findUnique({
    where: {
      operationId_partyId_role: {
        operationId,
        partyId: input.partyId,
        role: input.role,
      },
    },
  });

  if (existingPartyRole) {
    throw new ConflictError(
      `El participante ya cuenta con el rol ${input.role} en esta operación`,
      "DUPLICATE_PARTY_ROLE_IN_OPERATION"
    );
  }

  const party = await prisma.operationParty.create({
    data: {
      operationId,
      partyId: input.partyId,
      role: input.role,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
    },
  });

  track("operation_party_added", {
    operationId,
    partyId: input.partyId,
    role: input.role,
  });

  return party;
}

/**
 * ALP3-002: Vincular activo a una operación
 */
export async function addAssetToOperation(
  operationId: string,
  input: CreateOperationAssetInput
) {
  const op = await prisma.operation.findUnique({ where: { id: operationId } });
  if (!op) {
    throw new NotFoundError(`Operación con ID ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
  }

  // Prevenir duplicado de activo en la misma operación
  const existingAsset = await prisma.operationAsset.findUnique({
    where: {
      operationId_assetId: {
        operationId,
        assetId: input.assetId,
      },
    },
  });

  if (existingAsset) {
    throw new ConflictError(
      `El activo ${input.assetId} ya está vinculado a esta operación`,
      "DUPLICATE_ASSET_IN_OPERATION"
    );
  }

  const asset = await prisma.operationAsset.create({
    data: {
      operationId,
      assetId: input.assetId,
      unitId: input.unitId ?? null,
      role: input.role ?? "PRIMARY",
      agreedPrice: input.agreedPrice ?? null,
    },
  });

  track("operation_asset_added", {
    operationId,
    assetId: input.assetId,
    role: input.role,
  });

  return asset;
}
