import { NextResponse } from "next/server";

// Backend reachability probe (added for Phase 26+ debugging).
//
// GET /api/health → always 200. The probe REPORTS backend reachability; it never
// fails the orchestrator/healthchecker:
//   * any HTTP response from BACKEND_URL (even 404/5xx) → backend: "up"
//   * fetch rejection or 2s abort (timeout)            → backend: "down"
//   * missing BACKEND_URL                              → backend: "unknown"

export async function GET() {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return NextResponse.json({ status: "ok", backend: "unknown" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    // ANY HTTP response counts as reachable — we don't inspect the status.
    await fetch(backendUrl, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return NextResponse.json({ status: "ok", backend: "up" });
  } catch {
    // Fetch rejection or abort (timeout) → unreachable. clearTimeout on an
    // already-fired timer is a no-op.
    clearTimeout(timeout);
    return NextResponse.json({ status: "ok", backend: "down" });
  }
}