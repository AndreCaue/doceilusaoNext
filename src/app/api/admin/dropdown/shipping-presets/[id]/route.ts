import { NextResponse, type NextRequest } from "next/server";
import {
  proxyShippingPresetById,
  requireMaster,
} from "@/lib/admin-proxy";

// STORE-04/05: fetch a single shipping preset by id for the admin form's
// handleChangePresets autofill (weight/dimensions/discount). Master-scope gated.
type TParams = { id: string };

export async function GET(req: NextRequest, { params }: { params: Promise<TParams> }) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const { id: rawId } = await params;
  const id = Number.parseInt(rawId?.trim(), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: "ID inválido", code: "INVALID_ID", retryable: false },
      { status: 400 },
    );
  }

  const result = await proxyShippingPresetById(id);
  return NextResponse.json(result.data, { status: result.ok ? 200 : result.status });
}
