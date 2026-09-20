import { NextResponse, type NextRequest } from "next/server";
import {
  proxyProductCreate,
  requireMaster,
} from "@/lib/admin-proxy";

// Admin product create proxy (STORE-05, D-11).
// POST /api/admin/products -> Python POST /products/register (multipart passthrough).
// Single-writer: Python owns S3 upload, image-replace, stock/price validation.
// Master-scope gated server-side (T-27-06-01) — an API route can be hit without
// the (admin) page layout, so it must re-verify scope independently.
export async function POST(req: NextRequest) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const formData = await req.formData();
  const result = await proxyProductCreate(formData);
  const status = result.ok ? 200 : result.status;
  const body = result.ok ? result.data : result.data;
  return NextResponse.json(body, { status });
}
