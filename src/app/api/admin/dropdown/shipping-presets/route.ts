import { NextResponse, type NextRequest } from "next/server";
import {
  proxyDropdownShippingPresets,
  requireMaster,
} from "@/lib/admin-proxy";

// STORE-04: product-options endpoint for admin form shipping-preset dropdown.
// Master-scope gated server-side (T-27-06-01).
export async function GET(req: NextRequest) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const result = await proxyDropdownShippingPresets();
  return NextResponse.json(result.data, { status: result.ok ? 200 : result.status });
}
