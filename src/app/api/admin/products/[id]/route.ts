import { NextResponse, type NextRequest } from "next/server";
import {
  proxyProductDelete,
  proxyProductUpdate,
  requireMaster,
} from "@/lib/admin-proxy";

// Admin product update + delete proxy handlers (STORE-05, D-11/D-12).
//   PUT    /api/admin/products/[id] -> Python PUT /products/{id} (multipart)
//   DELETE /api/admin/products/[id] -> Python DELETE /products/{id}  (Plan 27-02)
// Master-scope gated server-side (T-27-06-01 / T-27-06-04).

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

  const formData = await req.formData();
  const result = await proxyProductUpdate(id, formData);
  const body = result.ok ? result.data : result.data;
  return NextResponse.json(body, { status: result.ok ? 200 : result.status });
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

  const result = await proxyProductDelete(id);
  const body = result.ok ? result.data : result.data;
  return NextResponse.json(body, { status: result.ok ? 200 : result.status });
}
