import { NextResponse, type NextRequest } from "next/server";
import {
  proxyCategoryUpdate,
  proxyCategoryDelete,
  requireMaster,
} from "@/lib/admin-proxy";

// Admin category update + delete proxy handlers (STORE-06, D-11/D-14).
//   PUT    /api/admin/categories/[id] -> Python PUT /category/update/{id} (JSON)
//   DELETE /api/admin/categories/[id] -> Python DELETE /category/delete/{id}
// Master-scope gated server-side (T-27-07-01).
// Python owns validation + the product-reference delete guard (D-14) —
// Next does NOT reimplement the guard, just propagates the 400 response.

type TParams = { id: string };

async function parseId(raw: string): Promise<number | null> {
  const trimmed = raw?.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    return null;
  }
  return parsed;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<TParams> }) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const { id: rawId } = await params;
  const id = await parseId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "ID inválido", code: "INVALID_ID", retryable: false },
      { status: 400 },
    );
  }

  const body = await req.json();
  const result = await proxyCategoryUpdate(id, body);
  return NextResponse.json(result.data, { status: result.ok ? 200 : result.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<TParams> }) {
  const gate = await requireMaster(_req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  const { id: rawId } = await params;
  const id = await parseId(rawId);
  if (id === null) {
    return NextResponse.json(
      { error: "ID inválido", code: "INVALID_ID", retryable: false },
      { status: 400 },
    );
  }

  // Propagate Python's 400 (product-reference delete guard, D-14) to the caller.
  // Do NOT reimplement the guard in Next — Python is the single source of truth.
  const result = await proxyCategoryDelete(id);
  return NextResponse.json(result.data, { status: result.ok ? 200 : result.status });
}
