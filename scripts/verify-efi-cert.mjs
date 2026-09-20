// Efí .p12 client-certificate deterministic verifier (FOUND-06, plan 25-04).
//
// Zero-dependency ESM script. Run with:
//   npm run verify:efi-cert
// which invokes: node --env-file=.env.local scripts/verify-efi-cert.mjs
// (.env.local is gitignored; --env-file loads it natively — no dotenv dep.)
//
// Exit codes:
//   0  OK — p12 decoded, parsed, agent constructed, sandbox config printed
//   1  Cert/OpenSSL failure — createSecureContext rejected the p12
//   2  Missing env — EFI_CERTIFICATE_BASE64 and/or EFI_CERT_PASSPHRASE absent
//
// Checks (in order, first failure exits):
//   P1 env   — both secret vars present (names only, never values)
//   P2 decode — base64 -> Buffer (prints decoded byte length only)
//   P3 parse — createSecureContext({ pfx, passphrase }) — THIS is where
//              ERR_OSSL_PKCS12_PBE_CRYPT / "unsupported" (legacy PBE cipher)
//              surfaces under OpenSSL 3.x. Full code/message is printed.
//   P4 agent — https.Agent({ pfx, passphrase, rejectUnauthorized: true })
//   P5 sandbox — EFI_SANDBOX gate mirroring getEfiSandboxConfig() in
//              ../lib/efi-cert.ts (same regex; pure function of the env var).
//
// NEVER prints: the base64, the passphrase, or derived key material.
//
// ─── OpenSSL 3.x remediation (documented — NOT auto-executed) ─────────────
// If P3 fails with a legacy-cipher error (ERR_OSSL_PKCS12_PBE_CRYPT /
// "unsupported"), re-encode the .p12 with modern ciphers, then re-set
// EFI_CERTIFICATE_BASE64 to the new base64:
//   openssl pkcs12 -in cert.p12 -out temp.pem -nodes
//   openssl pkcs12 -export -in temp.pem -out cert-modern.p12 -passout pass:<newpass>
// Runtime `NODE_OPTIONS=--openssl-legacy-provider` is the LAST-RESORT manual
// fallback only — it is never a code change and never a default.

import https from "node:https";
import tls from "node:tls";

// ─── P1: env presence ────────────────────────────────────────────
const base64 = process.env.EFI_CERTIFICATE_BASE64;
const passphrase = process.env.EFI_CERT_PASSPHRASE;

const missing = [];
if (!base64) missing.push("EFI_CERTIFICATE_BASE64");
if (!passphrase) missing.push("EFI_CERT_PASSPHRASE");

if (missing.length > 0) {
  console.log(`P1 FAIL: missing env ${missing.join(", ")}`);
  console.log("Set them in doceilusao-next/.env.local (gitignored) and re-run.");
  process.exit(2);
}
console.log("P1 OK: EFI_CERTIFICATE_BASE64 and EFI_CERT_PASSPHRASE are present");

// ─── P2: base64 decode ───────────────────────────────────────────
const pfx = Buffer.from(base64, "base64");
console.log(`P2 OK: decoded ${pfx.length} bytes from EFI_CERTIFICATE_BASE64`);

// ─── P3: parse the p12 (OpenSSL 3.x landmine lives here) ────────
// tls.createSecureContext is the canonical Node API (crypto.createSecureContext
// is not exported on Node 22 — the error would be "not a function").
try {
  tls.createSecureContext({ pfx, passphrase });
  console.log("P3 OK: createSecureContext parsed the p12 (no OpenSSL errors)");
} catch (err) {
  const code = err && typeof err.code === "string" ? err.code : "unknown";
  const message = err && typeof err.message === "string" ? err.message : String(err);
  console.log(`P3 FAIL: code=${code} message=${message}`);
  console.log(
    "Remediation: re-encode the .p12 with modern ciphers (see header comment), " +
      "or use the documented NODE_OPTIONS=--openssl-legacy-provider last-resort fallback."
  );
  process.exit(1);
}

// ─── P4: https.Agent construction ────────────────────────────────
new https.Agent({ pfx, passphrase, rejectUnauthorized: true });
console.log("P4 OK: https.Agent constructed (rejectUnauthorized: true)");
console.log("EFI_SECURE_CONTEXT_OK");

// ─── P5: sandbox config (mirrors ../lib/efi-cert.ts) ─────────────
const sandbox = /^(true|1)$/i.test(process.env.EFI_SANDBOX ?? "");
const baseUrl = sandbox
  ? "https://pix-h.api.efipay.com.br"
  : "https://pix.api.efipay.com.br";
const extraHeaderKeys = sandbox ? ["x-skip-mtls-checking"] : [];
console.log(
  `P5 sandbox: sandbox=${sandbox} baseUrl=${baseUrl} extraHeaders keys: ${extraHeaderKeys.join(", ") || "(none)"}`
);

process.exit(0);