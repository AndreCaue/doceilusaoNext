import { NextResponse, type NextRequest } from "next/server";
import {
  proxyCategoryCreate,
  requireMaster,
} from "@/lib/admin-proxy";

// Admin category create proxy (STORE-06, D-11).
// POST /api/admin/categories -> Python POST /category/register (JSON).
// Single-writer: Python owns name uniqueness, validation, all category data.
// Master-scope gated server-side (T-27-07-01) — an API route can be hit without
// the (admin) page layout, so it must re-verify scope independently.
export async function POST(req: NextRequest) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const body = await req.json();
  const result = await proxyCategoryCreate(body);
  const status = result.ok ? 200 : result.status;
  return NextResponse.json(result.data, { status });
}
