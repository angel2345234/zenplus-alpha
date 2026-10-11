import type { FastifyInstance } from "fastify";
import fjwt from "@fastify/jwt";

export function registerAuth(app: FastifyInstance) {
  const secret = process.env.JWT_SECRET ?? "dev-secret-change-me";

  if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET es obligatorio en producción");
  }

  app.register(fjwt, {
    secret,
  });

  app.decorate("authenticate", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Authentication required",
        requestId: req.id,
      });
    }
  });
}
