import { prisma } from '../../lib/prisma';
import type { CreateRequirementInput, UpdateRequirementInput } from './requirement.schema';

export class RequirementNotFoundError extends Error {
  constructor(id: string) {
    super(`Requirement ${id} no encontrado`);
    this.name = 'RequirementNotFoundError';
  }
}

export async function createRequirement(input: CreateRequirementInput) {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
  });

  if (!opportunity) {
    throw new Error(`Opportunity ${input.opportunityId} no existe`);
  }

  return prisma.requirement.create({
    data: {
      opportunityId: input.opportunityId,
      operationType: input.operationType,
      assetType: input.assetType ?? "APARTMENT",
      zones: input.zones,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      currency: input.currency,
      areaMin: input.areaMin,
      areaMax: input.areaMax,
      attributes: input.attributes,
      timeHorizon: input.timeHorizon,
    },
  });
}

export async function getRequirementByOpportunity(opportunityId: string) {
  const requirement = await prisma.requirement.findFirst({
    where: { opportunityId },
  });

  if (!requirement) {
    throw new RequirementNotFoundError(opportunityId);
  }

  return requirement;
}

export async function updateRequirement(id: string, input: UpdateRequirementInput) {
  const existing = await prisma.requirement.findUnique({ where: { id } });

  if (!existing) {
    throw new RequirementNotFoundError(id);
  }

  return prisma.requirement.update({
    where: { id },
    data: input,
  });
}