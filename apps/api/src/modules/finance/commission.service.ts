import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export interface CalculateCommissionInput {
  operationId: string;
  advisorPartyId: string;
  role: string;
  basisAmount: number;
  percentage: number;
}

export async function calculateCommercialCommission(input: CalculateCommissionInput) {
  const { operationId, advisorPartyId, role, basisAmount, percentage } = input;

  if (basisAmount <= 0 || percentage <= 0) {
    throw new Error("El monto base y el porcentaje deben ser mayores a 0");
  }

  const finalCommissionAmount = Number(((basisAmount * percentage) / 100).toFixed(2));

  const commission = await prisma.commercialCommission.create({
    data: {
      operationId,
      advisorPartyId,
      role,
      basisAmount: new Prisma.Decimal(basisAmount),
      percentage: new Prisma.Decimal(percentage),
      finalCommissionAmount: new Prisma.Decimal(finalCommissionAmount),
      status: "CALCULATED",
    },
  });

  return {
    success: true,
    commissionId: commission.id,
    basisAmount,
    percentage,
    finalCommissionAmount,
    status: commission.status,
  };
}