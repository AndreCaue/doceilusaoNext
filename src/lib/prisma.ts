import { PrismaClient } from "@prisma/client";

// Singleton Prisma client for server-side use (App Router server components,
// route handlers, Server Actions). Never instantiate in client components.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
