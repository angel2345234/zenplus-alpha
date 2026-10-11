import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { operationStageEnum } from "./operation.schema";
import { ConflictError, NotFoundError } from "./operation.service";
import {
  addDocumentVersion,
  createDocumentRequirement,
  createOperationDocument,
  getOperationStageHistory,
  transitionOperationStage,
} from "./operation-foundation.service";

const objectMetadata = z.record(z.unknown()).optional().default({});
const requirementSchema = z.object({
  requirementCode: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  description: z.string().max(5000).optional(),
  requiredForStage: operationStageEnum.optional(),
  isRequired: z.boolean().optional().default(true),
  metadata: objectMetadata,
});
const documentSchema = z.object({
  requirementId: z.string().uuid().optional(),
  documentType: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  createdBy: z.string().max(100).optional(),
  metadata: objectMetadata,
});
const versionSchema = z.object({
  storageProvider: z.string().trim().min(1).max(40),
  storageKey: z.string().trim().min(1).max(2000),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().nonnegative().safe(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  uploadedBy: z.string().max(100).optional(),
  metadata: objectMetadata,
});
const transitionSchema = z.object({
  stage: operationStageEnum,
  changedBy: z.string().trim().min(1).max(100).optional().default("SYSTEM"),
  reason: z.string().max(2000).optional(),
});

export async function operationFoundationRoutes(app: FastifyInstance) {
  app.get("/operations/:id/history", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return reply.send({ success: true, data: await getOperationStageHistory(id) });
    } catch (error) { return handleError(error, reply); }
  });


  app.post("/operations/:id/document-requirements", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const input = requirementSchema.parse(req.body);
      const data = await createDocumentRequirement(id, input);
      return reply.status(201).send({ success: true, data });
    } catch (error) { return handleError(error, reply); }
  });

  app.post("/operations/:id/documents", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const input = documentSchema.parse(req.body);
      const data = await createOperationDocument(id, input);
      return reply.status(201).send({ success: true, data });
    } catch (error) { return handleError(error, reply); }
  });

  app.post("/operations/documents/:documentId/versions", async (req, reply) => {
    try {
      const { documentId } = req.params as { documentId: string };
      const input = versionSchema.parse(req.body);
      const data = await addDocumentVersion(documentId, input);
      return reply.status(201).send({ success: true, data: { ...data, sizeBytes: data.sizeBytes.toString() } });
    } catch (error) { return handleError(error, reply); }
  });
}

function handleError(error: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof NotFoundError) return reply.status(404).send({ error: error.code, message: error.message });
  if (error instanceof ConflictError) return reply.status(409).send({ error: error.code, message: error.message, details: error.details });
  if (error instanceof z.ZodError) return reply.status(400).send({ error: "VALIDATION_ERROR", issues: error.issues });
  throw error;
}
