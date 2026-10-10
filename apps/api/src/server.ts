import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { requestIdHook } from "./lib/requestId";
import { registerAuth } from "./plugins/auth";
import { registerAuthorize } from "./plugins/authorize";
import { registerErrorHandler } from "./plugins/errorHandler";
import { increment } from "./lib/metrics";
import { platformRoutes } from "./modules/platform/health";
import { leadRoutes } from "./modules/crm/lead.routes";
import { opportunityRoutes } from "./modules/crm/opportunity.routes";
import { requirementRoutes } from "./modules/crm/requirement.routes";
import { visitRoutes } from "./modules/crm/visit.routes";
import { assetRoutes } from "./modules/inventory/asset.routes";
import { projectRoutes } from "./modules/inventory/project.routes";
import { authRoutes } from "./modules/iam/auth.routes";
import { financeRoutes } from "./modules/finance/finance.routes";

async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });
  await registerAuth(app);
  await registerAuthorize(app);
  app.addHook("onRequest", requestIdHook);
  app.addHook("onResponse", async (req, reply) => {
    const route = (req as any).routeOptions?.url ?? req.url;
    increment(`request:${req.method}:${route}:${reply.statusCode}`);
    increment(`request:${req.method}:total`);
  });
  registerErrorHandler(app);

  await app.register(platformRoutes);
  await app.register(leadRoutes);
  await app.register(opportunityRoutes);
  await app.register(requirementRoutes);
  await app.register(visitRoutes);
  await app.register(assetRoutes);
  await app.register(projectRoutes);
  await app.register(authRoutes);
  await app.register(financeRoutes, { prefix: "/api/finance" });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`ZENPLUS API on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});