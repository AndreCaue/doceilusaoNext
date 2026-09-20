// Idempotent synthetic test-user seeder — route smoke-test support for plans
// 26-05 / 26-07 / 26-08.
//
// Run (from doceilusao-next/):  node --env-file=.env.local scripts/seed-auth-test-user.mjs
//
// Prisma needs DATABASE_URL. The repo's env contract (Phase 25 D-10) keeps the
// Prisma DB vars in doceilusao-next/.env while .env.local holds the app-side
// vars — so this script falls back to parsing ../.env when DATABASE_URL is not
// already in process.env (the --env-file=.env.local invocation provides
// everything else; both files together reproduce the dev env).
//
// Seeds TWO synthetic users (NEVER real data — git-trackable, harmless):
//   auth-test@doceilusao.local    scopes ["basic"]           role null     is_verified true
//   auth-master@doceilusao.local  scopes ["basic","master"]  role "master" is_verified true
//   both: password "Teste-1234" (bcryptjs cost 12 — same format as password.ts)
//
// Idempotency: delete-then-create inside ONE transaction with the users'
// existing refresh_tokens cleared first (clean slate on every run). Logs each
// email + uuid after seeding, then asserts all rows exist — exits non-zero on
// any failure.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "Teste-1234";
const BCRYPT_ROUNDS = 12;

const USERS = [
  { email: "auth-test@doceilusao.local", scopes: ["basic"], role: null, is_verified: true },
  { email: "auth-master@doceilusao.local", scopes: ["basic", "master"], role: "master", is_verified: true },
];

/** DATABASE_URL from process.env, falling back to parsing doceilusao-next/.env. */
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // script lives at doceilusao-next/scripts/ → ../.env is doceilusao-next/.env
  const envPath = new URL("../.env", import.meta.url);
  try {
    const raw = readFileSync(envPath, "utf8");
    const match = raw.match(/^DATABASE_URL=(.*)$/m);
    if (match && match[1]) {
      return match[1].trim().replace(/^"|"$/g, "");
    }
  } catch {
    // fall through to the Prisma error below
  }
  return undefined;
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ausente — rode com --env-file=.env.local (e .env com DATABASE_URL no doceilusao-next)");
  }
  // only set when we sourced it ourselves; Prisma otherwise reads its own env
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = databaseUrl;
  }

  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const emails = USERS.map((u) => u.email);

  // Clean slate: existing rows for these emails (and THEIR refresh tokens) are
  // removed before re-creating — re-runs are safe and deterministic.
  const existing = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const existingIds = existing.map((u) => u.id);

  const created = await prisma.$transaction(async (tx) => {
    if (existingIds.length > 0) {
      await tx.refreshToken.deleteMany({ where: { user_id: { in: existingIds } } });
      await tx.user.deleteMany({ where: { id: { in: existingIds } } });
    }

    const rows = [];
    for (const user of USERS) {
      rows.push(
        await tx.user.create({
          data: {
            uuid: randomUUID(),
            email: user.email,
            password: passwordHash,
            scopes: user.scopes,
            role: user.role,
            is_verified: user.is_verified,
          },
        }),
      );
    }
    return rows;
  });

  if (created.length !== USERS.length) {
    throw new Error(`esperava ${USERS.length} usuários, criei ${created.length}`);
  }

  // Assert each row actually exists post-commit.
  const after = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, uuid: true },
  });
  for (const email of emails) {
    if (!after.some((u) => u.email === email)) {
      throw new Error(`linha de ${email} ausente após o seed`);
    }
  }

  for (const row of after) {
    console.log(`seeded ${row.email} uuid=${row.uuid}`);
  }
  console.log("seed ok — usuários sintéticos prontos para smoke tests");
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error("seed failed:", err instanceof Error ? err.message : String(err));
  exitCode = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(exitCode);