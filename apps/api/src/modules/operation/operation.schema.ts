import { z } from "zod";

export const partyRoleEnum = z.enum([
  "BUYER",
  "SELLER",
  "LESSOR",
  "TENANT",
  "ADVISOR",
  "LEGAL_REP",
]);

export const assetRoleEnum = z.enum([
  "PRIMARY",
  "PARKING",
  "STORAGE",
  "SECONDARY",
]);

export const operationTypeEnum = z.enum(["SALE", "RENT"]);

export const operationStageEnum = z.enum([
  "DRAFT",
  "RESERVATION_HANDOFF",
  "DOCUMENT_COLLECTION",
  "CONTRACT_PENDING",
  "SIGNING",
  "SETTLED",
  "CANCELLED",
]);

export const createOperationPartySchema = z.object({
  partyId: z.string().uuid("partyId must be a valid UUID"),
  role: partyRoleEnum,
  isPrimary: z.boolean().optional().default(false),
  notes: z.string().max(1000).optional(),
});

export const createOperationAssetSchema = z.object({
  assetId: z.string().uuid("assetId must be a valid UUID"),
  unitId: z.string().uuid("unitId must be a valid UUID").optional().nullable(),
  role: assetRoleEnum.optional().default("PRIMARY"),
  agreedPrice: z.number().positive().optional().nullable(),
});

export const handoffReservationSchema = z.object({
  reservationId: z.string().uuid("reservationId must be a valid UUID"),
  operationType: operationTypeEnum.optional().default("SALE"),
  agreedAmount: z.number().positive("agreedAmount must be a positive number"),
  currency: z.string().length(3).optional().default("USD"),
  handedOffBy: z.string().max(100).optional(),
  snapshotData: z.record(z.any()).optional().default({}),
  parties: z.array(createOperationPartySchema).optional().default([]),
  assets: z.array(createOperationAssetSchema).optional().default([]),
  notes: z.string().max(2000).optional(),
});

export const updateOperationStageSchema = z.object({
  stage: operationStageEnum,
  notes: z.string().max(1000).optional(),
});

export const listOperationsQuerySchema = z.object({
  stage: operationStageEnum.optional(),
  operationType: operationTypeEnum.optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
});

export type PartyRole = z.infer<typeof partyRoleEnum>;
export type AssetRole = z.infer<typeof assetRoleEnum>;
export type OperationType = z.infer<typeof operationTypeEnum>;
export type OperationStage = z.infer<typeof operationStageEnum>;
export type CreateOperationPartyInput = z.infer<typeof createOperationPartySchema>;
export type CreateOperationAssetInput = z.infer<typeof createOperationAssetSchema>;
export type HandoffReservationInput = z.infer<typeof handoffReservationSchema>;
export type UpdateOperationStageInput = z.infer<typeof updateOperationStageSchema>;
export type ListOperationsQuery = z.infer<typeof listOperationsQuerySchema>;
