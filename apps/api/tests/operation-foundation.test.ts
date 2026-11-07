
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, tx } = vi.hoisted(() => {
  const tx = {
    operation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    operationStageHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    assetCommercialState: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    operationDocumentRequirement: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    operationDocument: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    operationDocumentVersion: {
      create: vi.fn(),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: vi.fn(),
      operation: {
        findUnique: vi.fn(),
      },
      operationStageHistory: {
        findMany: vi.fn(),
      },
      operationDocumentRequirement: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      operationDocument: {
        create: vi.fn(),
      },
    },
  };
});

vi.mock("../src/lib/prisma", () => ({ prisma }));

import {
  transitionOperationStage,
  getOperationStageHistory,
  createDocumentRequirement,
  createOperationDocument,
  addDocumentVersion,
} from "../src/modules/operation/operation-foundation.service";

const operationId = "operation-test";
const documentId = "document-test";

function mockOperation(stage = "DRAFT") {
  return {
    id: operationId,
    stage,
    operationType: "SALE",
    assets: [{ assetId: "asset-test", unitId: null }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  prisma.$transaction.mockImplementation(async (callback: any) =>
    callback(tx),
  );

  tx.operation.findUnique.mockResolvedValue(mockOperation());

  tx.operation.update.mockImplementation(async ({ data }: any) => ({
    ...mockOperation(data.stage),
    parties: [],
    handoff: null,
  }));

  tx.operationStageHistory.create.mockResolvedValue({});
  tx.assetCommercialState.findFirst.mockResolvedValue(null);
  tx.assetCommercialState.create.mockResolvedValue({});
  tx.assetCommercialState.update.mockResolvedValue({});

  prisma.operation.findUnique.mockResolvedValue({ id: operationId });
  prisma.operationStageHistory.findMany.mockResolvedValue([]);

  // Los requisitos documentales se consultan mediante prisma directamente.
  prisma.operationDocumentRequirement.findFirst.mockResolvedValue({
    id: "requirement-test",
    operationId,
  });

  prisma.operationDocumentRequirement.create.mockResolvedValue({
    id: "requirement-test",
  });

  tx.operationDocumentRequirement.findFirst.mockResolvedValue({
    id: "requirement-test",
    operationId,
  });

  tx.operationDocumentRequirement.create.mockResolvedValue({
    id: "requirement-test",
  });

  tx.operationDocument.findUnique.mockResolvedValue({
    id: documentId,
    currentVersion: 0,
  });

  tx.operationDocument.create.mockResolvedValue({
    id: documentId,
    currentVersion: 0,
  });

  tx.operationDocument.update.mockResolvedValue({});

  tx.operationDocumentVersion.create.mockImplementation(
    async ({ data }: any) => ({
      id: "version-test",
      ...data,
    }),
  );
});

describe("ALP3-003: ciclo de vida e historial", () => {
  it("registra la transición válida con actor y motivo", async () => {
    await transitionOperationStage(
      operationId,
      "RESERVATION_HANDOFF",
      "advisor-test",
      "Reserva recibida",
    );

    expect(tx.operation.update).toHaveBeenCalled();

    expect(tx.operationStageHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId,
        fromStage: "DRAFT",
        toStage: "RESERVATION_HANDOFF",
        changedBy: "advisor-test",
        reason: "Reserva recibida",
      }),
    });
  });

  it("rechaza una transición inválida", async () => {
    await expect(
      transitionOperationStage(operationId, "SETTLED"),
    ).rejects.toMatchObject({
      code: "INVALID_OPERATION_STAGE_TRANSITION",
    });

    expect(tx.operation.update).not.toHaveBeenCalled();
    expect(tx.operationStageHistory.create).not.toHaveBeenCalled();
  });

  it("no permite repetir la etapa actual", async () => {
    tx.operation.findUnique.mockResolvedValue(
      mockOperation("DOCUMENT_COLLECTION"),
    );

    await expect(
      transitionOperationStage(operationId, "DOCUMENT_COLLECTION"),
    ).rejects.toMatchObject({
      code: "OPERATION_STAGE_UNCHANGED",
    });
  });

  it("consulta el historial de la operación", async () => {
    const history = [
      {
        fromStage: "DRAFT",
        toStage: "RESERVATION_HANDOFF",
      },
    ];

    prisma.operationStageHistory.findMany.mockResolvedValue(history);

    await expect(getOperationStageHistory(operationId)).resolves.toEqual(
      history,
    );
  });
});

describe("ALP3-004: estado comercial independiente", () => {
  it("marca el activo como reservado sin actualizar el inventario", async () => {
    await transitionOperationStage(
      operationId,
      "RESERVATION_HANDOFF",
    );

    expect(tx.assetCommercialState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetId: "asset-test",
        commercialStatus: "RESERVED",
        sourceOperationId: operationId,
      }),
    });

    // El servicio no debe modificar directamente el estado del activo.
    expect((tx as any).asset).toBeUndefined();
  });

  it("marca una cancelación para revisión, no como disponible", async () => {
    tx.operation.findUnique.mockResolvedValue(
      mockOperation("RESERVATION_HANDOFF"),
    );

    await transitionOperationStage(operationId, "CANCELLED");

    expect(tx.assetCommercialState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commercialStatus: "REVIEW_REQUIRED",
      }),
    });
  });
});

describe("ALP3-005: requisitos y versiones documentales", () => {
  it("crea un requisito documental", async () => {
    await createDocumentRequirement(operationId, {
      requirementCode: "ID_BUYER",
      name: "Identificación del comprador",
    });

    expect(
      prisma.operationDocumentRequirement.create,
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId,
        requirementCode: "ID_BUYER",
        name: "Identificación del comprador",
        isRequired: true,
      }),
    });
  });

  it("rechaza asociar un requisito de otra operación", async () => {
    prisma.operationDocumentRequirement.findFirst.mockResolvedValue(null);

    await expect(
      createOperationDocument(operationId, {
        requirementId: "other-requirement",
        documentType: "IDENTITY",
        title: "Documento de identidad",
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_REQUIREMENT_OPERATION_MISMATCH",
    });
  });

  it("crea una versión con referencia externa y número incremental", async () => {
    const version = await addDocumentVersion(documentId, {
      storageProvider: "S3",
      storageKey: "operations/test/document.pdf",
      originalFilename: "documento.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      uploadedBy: "advisor-test",
    });

    expect(tx.operationDocumentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentId,
        versionNumber: 1,
        storageProvider: "S3",
        storageKey: "operations/test/document.pdf",
        sizeBytes: BigInt(1024),
      }),
    });

    expect(tx.operationDocument.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: {
        currentVersion: 1,
        status: "UPLOADED",
      },
    });

    expect(version.versionNumber).toBe(1);
  });
});
