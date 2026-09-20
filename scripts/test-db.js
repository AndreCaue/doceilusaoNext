const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["error", "warn"],
});

async function main() {
  try {
    console.log("Tentando conectar...");
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log("✅ Conexão OK!", result);
  } catch (error) {
    console.error("❌ Erro de conexão:");
    console.error(error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
