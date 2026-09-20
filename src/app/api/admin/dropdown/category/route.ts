import { NextResponse, type NextRequest } from "next/server";
import {
  proxyDropdownCategory,
  requireMaster,
} from "@/lib/admin-proxy";

// STORE-04: product-options endpoint for admin form category dropdown.
// Master-scope gated server-side (T-27-06-01) — an API route can be hit without
// the (admin) page layout, so it must re-verify scope independently.
export async function GET(req: NextRequest) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const result = await proxyDropdownCategory();
  return NextResponse.json(result.data, { status: result.ok ? 200 : result.status });
}
