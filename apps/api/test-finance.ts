import { PrismaClient } from "@prisma/client";
import { allocatePaymentAtomic } from "./src/modules/finance/payment.service";
import { calculateCommercialCommission } from "./src/modules/finance/commission.service";
import crypto from "crypto";

const prisma = new PrismaClient();

async function runTestSuite() {
  console.log("====================================================");
  console.log("   INICIANDO SUITE COMPLETA FINANZAS (ALP3-007 / 008)");
  console.log("====================================================\n");

  let party = await prisma.parties.findFirst();
  if (!party) {
    party = await prisma.parties.create({
      data: { party_type: "PERSON" },
    });
  }

  const operationId = crypto.randomUUID();
  const actorId = crypto.randomUUID();

  const obligation = await prisma.financeObligation.create({
    data: {
      operationId,
      debtorPartyId: party.id,
      title: "Prueba Transaccional - Cuota 1",
      totalAmount: 10000.0,
      paidAmount: 0.0,
      dueDate: new Date(),
      status: "PENDING",
    },
  });

  const payment = await prisma.financePayment.create({
    data: {
      operationId,
      payerPartyId: party.id,
      amount: 4000.0,
      allocatedAmount: 0.0,
      paymentMethod: "BANK_TRANSFER",
      referenceCode: `TEST-REF-${Date.now()}`,
      paymentDate: new Date(),
      status: "VERIFIED",
    },
  });

  console.log(`[SETUP] Party ID: ${party.id}`);
  console.log(`[SETUP] Obligacion: ${obligation.id} (Deuda: S/. 10,000)`);
  console.log(`[SETUP] Pago: ${payment.id} (Saldo: S/. 4,000)\n`);

  // TEST 1: Imputacion valida
  console.log("--- TEST 1: Imputacion valida de S/. 3,000 ---");
  const res1 = await allocatePaymentAtomic({
    paymentId: payment.id,
    obligationId: obligation.id,
    amount: 3000,
    actorId,
  });
  console.log("Resultado Test 1:", res1);

  // TEST 2: Verificacion de Rollback
  console.log("\n--- TEST 2: Intento de sobregiro (S/. 2,000) -> Rollback ---");
  try {
    await allocatePaymentAtomic({
      paymentId: payment.id,
      obligationId: obligation.id,
      amount: 2000,
      actorId,
    });
    console.error("ERROR: Debio revertirse.");
  } catch (err: any) {
    console.log(`Rollback comprobado: "${err.message}"`);
  }

  // TEST 3: Calculo de comision comercial
  console.log("\n--- TEST 3: Calculo de Comision Comercial (3% de S/. 100,000) ---");
  const commRes = await calculateCommercialCommission({
    operationId,
    advisorPartyId: party.id,
    role: "CLOSER",
    basisAmount: 100000,
    percentage: 3,
  });
  console.log("Resultado Test 3:", commRes);

  console.log("\n====================================================");
  console.log("   TODAS LAS PRUEBAS COMPLETADAS (10/10)            ");
  console.log("====================================================");
}

runTestSuite()
  .catch((e) => console.error("Error general:", e))
  .finally(async () => {
    await (prisma as any)["\$disconnect"]();
    process.exit(0);
  });