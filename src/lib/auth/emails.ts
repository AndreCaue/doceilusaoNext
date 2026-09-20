// Email delivery — TS port of Backend/app/auth/email_service.py (D-10).
//
// Production: Resend REST API via plain fetch (no SDK — same call shape as the
// backend's `resend.Emails.send(params)`, key held ONLY in the Authorization
// header, read from env, never logged/bundled — Threat T-26-03-01).
// Development: nodemailer SMTP (mirrors smtplib + starttls). Missing SMTP creds
// throw a descriptive error PRE-send — backend parity (email_service.py:77-79),
// no silent email loss (Threat T-26-03-02).
//
// Templates + code generation are byte-faithful to email_service.py:
//   * 6-digit code, PBKDF2-HMAC-SHA256 (100 000 iterations) hex hash + 16-byte
//     hex salt — 15-min expiry persisted on the user row
//   * verification email: gold (#d4af37) code, "expira em 15 minutos"
//   * reset email: gold button link, "expira em 30 minutos"
//   * from: prod "Doce Ilusão <lojamagica@doceilusao.store>"; dev
//     FROM_EMAIL_DEV || FROM_EMAIL || "Doce Ilusão <mcd.magica.cartas@doceilusao.store>"
//
// Reset links target the NEXT page /redefinir-senha?token=... (D-09) with prod
// origin https://doceilusao.store (D-11).
//
// Node-runtime only (imports Prisma). Edge middleware must NOT import here.

import { pbkdf2Sync, randomBytes, randomInt } from "node:crypto";

import nodemailer from "nodemailer";

import { isProduction } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";

// ─── Code generation (email_service.py:101-107 exact algorithm) ──

/** 6-digit code + PBKDF2-HMAC-SHA256 (100k iter, 16-byte salt) hex hash/salt. */
export function generateVerificationCode(): {
  code: string;
  codeHashHex: string;
  saltHex: string;
} {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(code, salt, 100_000, 32, "sha256");
  return {
    code,
    codeHashHex: hash.toString("hex"),
    saltHex: salt.toString("hex"),
  };
}

// ─── Backend selection + from-address (email_service.py:19-30, 71-79) ──

/**
 * Which transport sends email in this environment.
 * Throws DESCRIPTIVE errors pre-send when credentials are missing (backend
 * parity — email_service.py raises in prod without RESEND_API_KEY and in dev
 * without SMTP_USER/SMTP_PASS; no silent email loss, Threat T-26-03-02).
 */
export function emailBackend(): "resend" | "smtp" {
  if (isProduction) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY NÃO DEFINIDA EM PRODUÇÃO");
    }
    return "resend";
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP_USER e SMTP_PASS são obrigatórios em development");
  }
  return "smtp";
}

/** From-address logic (email_service.py:22-30): prod fixed, dev override chain. */
function fromAddress(): string {
  if (isProduction) {
    return "Doce Ilusão <lojamagica@doceilusao.store>";
  }
  return (
    process.env.FROM_EMAIL_DEV ??
    process.env.FROM_EMAIL ??
    "Doce Ilusão <mcd.magica.cartas@doceilusao.store>"
  );
}

/**
 * HTML-escape interpolated values (Threat T-26-03-03 — values are almost
 * always digits/URL-safe base64, but keep the habit).
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ─── Shared transport (fetch → Resend | nodemailer → SMTP) ──────

type SendEmailParams = {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
};

async function sendEmail({ toEmail, subject, html, text }: SendEmailParams): Promise<void> {
  const from = fromAddress();

  if (emailBackend() === "resend") {
    // Threat T-26-03-01: key lives in the Authorization header only.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [toEmail], subject, html, text }),
    });
    if (!res.ok) {
      // Threat T-26-03-04 (accept): mirror backend — route returns HTTP 500
      // "Erro ao enviar e-mail" and the code stays on the row for resend.
      throw new Error(`Erro ao enviar email via Resend (HTTP ${res.status})`);
    }
    return;
  }

  // Dev SMTP path — emailBackend() already guaranteed SMTP_USER/SMTP_PASS;
  // re-checked so runtime parity holds even if emailBackend evolves.
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass) {
    throw new Error("SMTP_USER e SMTP_PASS são obrigatórios em development");
  }

  const smtpHost = process.env.SMTP_HOST ?? "smtp.gmail.com";
  const smtpPort = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);

  // secure: false → STARTTLS upgrade when the server advertises it
  // (smtplib.starttls() parity, email_service.py:91).
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });
  await transporter.sendMail({ from, to: toEmail, subject, html, text });
}

// ─── Verification email (email_service.py:16-98, 110-120) ────────

export async function sendVerificationEmail(params: {
  toEmail: string;
  code: string;
}): Promise<void> {
  const { toEmail, code } = params;
  const subject = "Código de Verificação - Loja de mágica Doce Ilusão";
  const safeCode = escapeHtml(code);

  const html = `
    <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2>Olá!</h2>
            <p>Seu código de verificação é:</p>
            <p style="font-size: 1.8em; font-weight: bold; color: #d4af37; letter-spacing: 5px;">
                ${safeCode}
            </p>
            <p>Ele expira em <strong>15 minutos</strong>.</p>
            <p>Se você não solicitou este código, ignore este e-mail.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 0.9em; color: #666;">Loja de Mágica Doce Ilusão</p>
        </body>
    </html>
    `;

  const text = `Seu código de verificação é: ${code}\nEle expira em 15 minutos.\nSe não solicitou este código, ignore este e-mail.`;

  await sendEmail({ toEmail, subject, html, text });
}

/** Generate + persist hash/salt/15-min expiry on the user row, then send (email_service.py:110-120). */
export async function generateAndSendVerification(userId: number): Promise<void> {
  const { code, codeHashHex, saltHex } = generateVerificationCode();
  const expiry = new Date(Date.now() + 15 * 60_000);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      verification_code: codeHashHex,
      salt: saltHex,
      code_expiry: expiry,
    },
  });

  await sendVerificationEmail({ toEmail: user.email, code });
}

// ─── Password-reset email (email_service.py:123-191) ─────────────

export async function sendResetPasswordEmail(params: {
  toEmail: string;
  resetLink: string;
  /** Greeting name — defaults to the email local-part (backend derives it from username). */
  username?: string;
}): Promise<void> {
  const { toEmail, resetLink } = params;
  const username = params.username ?? toEmail;
  const greetingName = username.includes("@") ? username.split("@")[0] : username;
  const subject = "Redefinição de Senha - Loja de Mágica Doce Ilusão";
  const safeGreeting = escapeHtml(greetingName);
  const safeLink = escapeHtml(resetLink);

  const html = `
    <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2>Olá, ${safeGreeting}!</h2>
            <p>Recebemos uma solicitação para redefinir sua senha.</p>
            <p>Clique no botão abaixo para criar uma nova senha:</p>
            <p style="text-align: center; margin: 30px 0;">
                <a href="${safeLink}" style="background-color: #d4af37; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                    Redefinir Senha
                </a>
            </p>
            <p>Este link expira em <strong>30 minutos</strong>.</p>
            <p>Se você não solicitou isso, ignore este e-mail — sua senha permanecerá segura.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 40px 0;">
            <p style="font-size: 0.9em; color: #666;">Loja de Mágica Doce Ilusão</p>
        </body>
    </html>
    `;

  const text = `
    Olá!

    Recebemos uma solicitação para redefinir sua senha.
    Acesse este link para criar uma nova senha: ${resetLink}

    O link expira em 30 minutos.

    Se não solicitou, ignore este e-mail.
    `;

  await sendEmail({ toEmail, subject, html, text });
}

// ─── Reset link builder (D-09 — NEXT page, D-11 — prod origin) ──

/** https://doceilusao.store/redefinir-senha?token=... in prod; http://localhost:3000 in dev. */
export function buildResetPasswordLink(token: string): string {
  const origin = isProduction ? "https://doceilusao.store" : "http://localhost:3000";
  return `${origin}/redefinir-senha?token=${token}`;
}