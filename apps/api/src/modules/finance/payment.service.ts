import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export interface AllocatePaymentInput {
  paymentId: string;
  obligationId: string;
  amount: number;
  actorId: string;
}

export async function allocatePaymentAtomic(input: AllocatePaymentInput) {
  const { paymentId, obligationId, amount, actorId } = input;

  if (amount <= 0) {
    throw new Error("El monto a imputar debe ser mayor a 0");
  }

  const runTransaction = (prisma as any)["\$transaction"].bind(prisma);

  return await runTransaction(async (tx: any) => {
    // 1. Obtener y validar el pago
    const payment = await tx.financePayment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error(`Pago no encontrado: ${paymentId}`);
    }

    if (payment.status !== "VERIFIED") {
      throw new Error(`Solo se pueden aplicar pagos verificados. Estado actual: ${payment.status}`);
    }

    const unallocatedPayment = Number(payment.amount) - Number(payment.allocatedAmount);
    if (amount > unallocatedPayment) {
      throw new Error(
        `Monto excede el saldo remanente del pago. Disponible: ${unallocatedPayment}, Solicitado: ${amount}`
      );
    }

    // 2. Obtener y validar la obligación
    const obligation = await tx.financeObligation.findUnique({
      where: { id: obligationId },
    });

    if (!obligation) {
      throw new Error(`Obligación no encontrada: ${obligationId}`);
    }

    if (obligation.status === "PAID" || obligation.status === "CANCELLED") {
      throw new Error(`La obligación ya se encuentra en estado terminal: ${obligation.status}`);
    }

    const remainingObligation = Number(obligation.totalAmount) - Number(obligation.paidAmount);
    if (amount > remainingObligation) {
      throw new Error(
        `Monto excede la deuda pendiente. Pendiente: ${remainingObligation}, Solicitado: ${amount}`
      );
    }

    // 3. Crear o actualizar asignación de pago (Upsert para respetar uq_payment_obligation)
    const allocation = await tx.financePaymentAllocation.upsert({
      where: {
        paymentId_obligationId: {
          paymentId,
          obligationId,
        },
      },
      update: {
        amountAllocated: { increment: new Prisma.Decimal(amount) },
        appliedBy: actorId,
      },
      create: {
        paymentId,
        obligationId,
        amountAllocated: new Prisma.Decimal(amount),
        appliedBy: actorId,
      },
    });

    // 4. Actualizar acumulado del pago
    await tx.financePayment.update({
      where: { id: paymentId },
      data: {
        allocatedAmount: { increment: amount },
      },
    });

    // 5. Actualizar acumulado y estado de la obligación
    const newPaidAmount = Number(obligation.paidAmount) + amount;
    const isCompleted = newPaidAmount >= Number(obligation.totalAmount);

    await tx.financeObligation.update({
      where: { id: obligationId },
      data: {
        paidAmount: { increment: amount },
        status: isCompleted ? "PAID" : "PARTIALLY_PAID",
      },
    });

    // 6. Auditoría inmutable de evento
    await tx.transactionEvent.create({
      data: {
        operationId: payment.operationId,
        eventType: "payment_allocated",
        actorId,
        actorRole: "ADMIN",
        payload: {
          payment_id: paymentId,
          obligation_id: obligationId,
          amount_allocated: amount,
          obligation_new_status: isCompleted ? "PAID" : "PARTIALLY_PAID",
        },
      },
    });

    return {
      success: true,
      allocationId: allocation.id,
      obligationStatus: isCompleted ? "PAID" : "PARTIALLY_PAID",
      amountApplied: amount,
    };
  });
}