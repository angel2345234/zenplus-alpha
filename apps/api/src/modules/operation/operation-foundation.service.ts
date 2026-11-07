import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ConflictError, NotFoundError } from "./operation.service";
import type { OperationStage } from "./operation.schema";

const TRANSITIONS: Record<OperationStage, OperationStage[]> = {
  DRAFT: ["RESERVATION_HANDOFF", "CANCELLED"],
  RESERVATION_HANDOFF: ["DOCUMENT_COLLECTION", "CANCELLED"],
  DOCUMENT_COLLECTION: ["CONTRACT_PENDING", "CANCELLED"],
  CONTRACT_PENDING: ["SIGNING", "CANCELLED"],
  SIGNING: ["SETTLED", "CANCELLED"],
  SETTLED: [],
  CANCELLED: [],
};

/**
 * ALP3-003 / ALP3-004. Changes the operation lifecycle and writes its audit event
 * in one transaction. Commercial availability is projected to a separate table;
 * inventory Publication Status is intentionally never updated here.
 */
export async function transitionOperationStage(
  operationId: string,
  toStage: OperationStage,
  changedBy = "SYSTEM",
  reason?: string,
) {
  return prisma.$transaction(async (tx) => {
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      include: { assets: true },
    });
    if (!operation) throw new NotFoundError(`Operación ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
    if (operation.stage === toStage) {
      throw new ConflictError("La operación ya se encuentra en esa etapa", "OPERATION_STAGE_UNCHANGED");
    }
    if (!TRANSITIONS[operation.stage].includes(toStage)) {
      throw new ConflictError(
        `Transición no permitida: ${operation.stage} → ${toStage}`,
        "INVALID_OPERATION_STAGE_TRANSITION",
        { from: operation.stage, to: toStage, allowed: TRANSITIONS[operation.stage] },
      );
    }

    const updated = await tx.operation.update({
      where: { id: operationId },
      data: { stage: toStage, ...(reason ? { notes: reason } : {}) },
      include: { parties: true, assets: true, handoff: true },
    });

    await tx.operationStageHistory.create({
      data: {
        operationId,
        fromStage: operation.stage,
        toStage,
        changedBy,
        reason: reason ?? null,
        metadata: { operationType: operation.operationType },
      },
    });

    const projectedStatus = commercialStatusForStage(toStage, operation.operationType);
    if (projectedStatus) {
      for (const asset of operation.assets) {
        const current = await tx.assetCommercialState.findFirst({
          where: { assetId: asset.assetId, unitId: asset.unitId },
        });
        // A cancellation is deliberately not projected as AVAILABLE automatically:
        // another active operation may exist, so mark it for reconciliation.
        const status = toStage === "CANCELLED" ? "REVIEW_REQUIRED" : projectedStatus;
        if (current) {
          await tx.assetCommercialState.update({
            where: { id: current.id },
            data: { commercialStatus: status, sourceOperationId: operationId, updatedAt: new Date() },
          });
        } else {
          await tx.assetCommercialState.create({
            data: {
              assetId: asset.assetId,
              unitId: asset.unitId,
              commercialStatus: status,
              sourceOperationId: operationId,
            },
          });
        }
      }
    }
    return updated;
  });
}

function commercialStatusForStage(stage: OperationStage, type: "SALE" | "RENT"): string | null {
  switch (stage) {
    case "RESERVATION_HANDOFF":
    case "DOCUMENT_COLLECTION": return "RESERVED";
    case "CONTRACT_PENDING":
    case "SIGNING": return "UNDER_CONTRACT";
    case "SETTLED": return type === "SALE" ? "SOLD" : "RENTED";
    case "CANCELLED": return "REVIEW_REQUIRED";
    case "DRAFT": return null;
  }
}

export async function getOperationStageHistory(operationId: string) {
  const exists = await prisma.operation.findUnique({ where: { id: operationId }, select: { id: true } });
  if (!exists) throw new NotFoundError(`Operación ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
  return prisma.operationStageHistory.findMany({ where: { operationId }, orderBy: { changedAt: "asc" } });
}

export async function createDocumentRequirement(operationId: string, input: {
  requirementCode: string; name: string; description?: string; requiredForStage?: OperationStage; isRequired?: boolean; metadata?: Record<string, unknown>;
}) {
  const exists = await prisma.operation.findUnique({ where: { id: operationId }, select: { id: true } });
  if (!exists) throw new NotFoundError(`Operación ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
  return prisma.operationDocumentRequirement.create({
    data: { operationId, requirementCode: input.requirementCode, name: input.name, description: input.description,
      requiredForStage: input.requiredForStage, isRequired: input.isRequired ?? true, metadata: (input.metadata ?? {}) as Prisma.InputJsonObject },
  });
}

export async function createOperationDocument(operationId: string, input: {
  requirementId?: string; documentType: string; title: string; createdBy?: string; metadata?: Record<string, unknown>;
}) {
  const exists = await prisma.operation.findUnique({ where: { id: operationId }, select: { id: true } });
  if (!exists) throw new NotFoundError(`Operación ${operationId} no encontrada`, "OPERATION_NOT_FOUND");
  if (input.requirementId) {
    const requirement = await prisma.operationDocumentRequirement.findFirst({ where: { id: input.requirementId, operationId } });
    if (!requirement) throw new ConflictError("El requisito no pertenece a esta operación", "DOCUMENT_REQUIREMENT_OPERATION_MISMATCH");
  }
  return prisma.operationDocument.create({ data: {
    operationId, requirementId: input.requirementId, documentType: input.documentType, title: input.title,
    createdBy: input.createdBy ?? "SYSTEM", metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
  } });
}

export async function addDocumentVersion(documentId: string, input: {
  storageProvider: string; storageKey: string; originalFilename: string; mimeType: string; sizeBytes: number;
  checksumSha256?: string; uploadedBy?: string; metadata?: Record<string, unknown>;
}) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.operationDocument.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundError(`Documento ${documentId} no encontrado`, "DOCUMENT_NOT_FOUND");
    const versionNumber = document.currentVersion + 1;
    const version = await tx.operationDocumentVersion.create({ data: {
      documentId, versionNumber, storageProvider: input.storageProvider, storageKey: input.storageKey,
      originalFilename: input.originalFilename, mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes),
      checksumSha256: input.checksumSha256, uploadedBy: input.uploadedBy ?? "SYSTEM", metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
    } });
    await tx.operationDocument.update({ where: { id: documentId }, data: { currentVersion: versionNumber, status: "UPLOADED" } });
    return version;
  });
}
