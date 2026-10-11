import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import type { LoginInput, RegisterInput } from "./auth.schema";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET es obligatorio en producción");
}

const JWT_SIGNING_SECRET = JWT_SECRET ?? "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new Error("EMAIL_ALREADY_EXISTS");

  const hashedPassword = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      password: hashedPassword,
      fullName: input.fullName,
      role: "ADVISOR",
    },
  });

  logger.info({ userId: user.id, email: user.email }, "User registered");
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new Error("INVALID_CREDENTIALS");

  const valid = await bcrypt.compare(input.password, user.password);
  if (!valid) throw new Error("INVALID_CREDENTIALS");

  const token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SIGNING_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  logger.info({ userId: user.id }, "User logged in");
  return {
    token,
    user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("USER_NOT_FOUND");
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}