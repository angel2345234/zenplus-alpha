import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  handoffReservationSchema,
  updateOperationStageSchema,
  createOperationPartySchema,
  createOperationAssetSchema,
  listOperationsQuerySchema,
} from "./operation.schema";
import {
  handoffReservationToOperation,
  getOperationById,
  getOperationByReservationId,
  listOperations,
  updateOperationStage,
  addPartyToOperation,
  addAssetToOperation,
  ConflictError,
  NotFoundError,
} from "./operation.service";

export async function operationRoutes(app: FastifyInstance) {
  /**
   * POST /operations/handoff
   * ALP3-001: Reservation -> Operation handoff
   * Idempotencia estricta 1:1, captura de snapshot y creación atómica
   */
  app.post("/operations/handoff", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const input = handoffReservationSchema.parse(req.body);
      const operation = await handoffReservationToOperation(input);
      return reply.status(201).send({
        success: true,
        data: operation,
      });
    } catch (err: any) {
      if (err instanceof ConflictError) {
        return reply.status(409).send({
          error: err.code,
          message: err.message,
          details: err.details,
          requestId: (req as any).id,
        });
      }
      if (err.name === "ZodError") {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: err.message,
          issues: err.errors,
          requestId: (req as any).id,
        });
      }
      req.log.error(err, "Error al procesar handoff de reserva a operación");
      throw err;
    }
  });

  /**
   * GET /operations
   * ALP3-002: Listado de operaciones con filtros y paginación
   */
  app.get("/operations", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = listOperationsQuerySchema.parse(req.query);
      const result = await listOperations(query);
      return reply.send({
        success: true,
        ...result,
      });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: err.message,
          issues: err.errors,
        });
      }
      throw err;
    }
  });

  /**
   * GET /operations/:id
   * Consulta detallada de operación con partes, activos y snapshot
   */
  app.get("/operations/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const operation = await getOperationById(req.params.id);
      return reply.send({
        success: true,
        data: operation,
      });
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.status(404).send({
          error: err.code,
          message: err.message,
          requestId: (req as any).id,
        });
      }
      throw err;
    }
  });

  /**
   * GET /operations/by-reservation/:reservationId
   * Consulta de operación por ID de reserva (búsqueda de handoff existente)
   */
  app.get(
    "/operations/by-reservation/:reservationId",
    async (req: FastifyRequest<{ Params: { reservationId: string } }>, reply: FastifyReply) => {
      try {
        const operation = await getOperationByReservationId(req.params.reservationId);
        return reply.send({
          success: true,
          data: operation,
        });
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        throw err;
      }
    }
  );

  /**
   * PATCH /operations/:id/stage
   * Transición de estado de operación
   */
  app.patch(
    "/operations/:id/stage",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const input = updateOperationStageSchema.parse(req.body);
        const updated = await updateOperationStage(req.params.id, input.stage, input.notes);
        return reply.send({
          success: true,
          data: updated,
        });
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        if (err.name === "ZodError") {
          return reply.status(400).send({
            error: "VALIDATION_ERROR",
            message: err.message,
            issues: err.errors,
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /operations/:id/parties
   * ALP3-002: Vinculación de un nuevo participante a la operación
   */
  app.post(
    "/operations/:id/parties",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const input = createOperationPartySchema.parse(req.body);
        const party = await addPartyToOperation(req.params.id, input);
        return reply.status(201).send({
          success: true,
          data: party,
        });
      } catch (err: any) {
        if (err instanceof ConflictError) {
          return reply.status(409).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        if (err.name === "ZodError") {
          return reply.status(400).send({
            error: "VALIDATION_ERROR",
            message: err.message,
            issues: err.errors,
          });
        }
        throw err;
      }
    }
  );

  /**
   * POST /operations/:id/assets
   * ALP3-002: Vinculación de un nuevo activo a la operación
   */
  app.post(
    "/operations/:id/assets",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const input = createOperationAssetSchema.parse(req.body);
        const asset = await addAssetToOperation(req.params.id, input);
        return reply.status(201).send({
          success: true,
          data: asset,
        });
      } catch (err: any) {
        if (err instanceof ConflictError) {
          return reply.status(409).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        if (err instanceof NotFoundError) {
          return reply.status(404).send({
            error: err.code,
            message: err.message,
            requestId: (req as any).id,
          });
        }
        if (err.name === "ZodError") {
          return reply.status(400).send({
            error: "VALIDATION_ERROR",
            message: err.message,
            issues: err.errors,
          });
        }
        throw err;
      }
    }
  );
}
