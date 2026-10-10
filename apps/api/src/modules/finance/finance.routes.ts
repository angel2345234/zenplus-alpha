import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { allocatePaymentAtomic } from "./payment.service";
import { calculateCommercialCommission } from "./commission.service";

export const financeRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Imputación atómica de pagos
  fastify.post("/payments/allocate", async (request, reply) => {
    try {
      const { paymentId, obligationId, amount, actorId } = request.body as {
        paymentId?: string;
        obligationId?: string;
        amount?: number;
        actorId?: string;
      };

      if (!paymentId || !obligationId || amount === undefined || !actorId) {
        return reply.status(400).send({
          ok: false,
          error: "Faltan campos obligatorios: paymentId, obligationId, amount, actorId",
        });
      }

      const result = await allocatePaymentAtomic({
        paymentId,
        obligationId,
        amount: Number(amount),
        actorId,
      });

      return reply.status(200).send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(400).send({
        ok: false,
        error: error.message || "Error al procesar la imputación del pago",
      });
    }
  });

  // Cálculo de comisiones comerciales
  fastify.post("/commissions/calculate", async (request, reply) => {
    try {
      const { operationId, advisorPartyId, role, basisAmount, percentage } = request.body as {
        operationId?: string;
        advisorPartyId?: string;
        role?: string;
        basisAmount?: number;
        percentage?: number;
      };

      if (!operationId || !advisorPartyId || !role || !basisAmount || !percentage) {
        return reply.status(400).send({
          ok: false,
          error: "Faltan campos obligatorios: operationId, advisorPartyId, role, basisAmount, percentage",
        });
      }

      const result = await calculateCommercialCommission({
        operationId,
        advisorPartyId,
        role,
        basisAmount: Number(basisAmount),
        percentage: Number(percentage),
      });

      return reply.status(200).send({
        ok: true,
        data: result,
      });
    } catch (error: any) {
      request.log.error(error);
      return reply.status(400).send({
        ok: false,
        error: error.message || "Error al calcular la comisión",
      });
    }
  });
};