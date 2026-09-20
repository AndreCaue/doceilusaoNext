import { NextResponse, type NextRequest } from "next/server";
import { requireMaster } from "@/lib/admin-proxy";
import { prisma } from "@/lib/prisma";

// Admin category reorder handler (STORE-06, D-13).
// POST /api/admin/categories/reorder — Next.js-owned reorder that persists
// sort_order via Prisma directly (the one intentional Next-owned write on
// category ordering). Python is untouched — its category list stays id-ordered.
//
// Body: { id: number; direction: "up" | "down" }
// Behavior: find the category in the ordered list, swap with its neighbor,
// then re-normalize all sort_order values to 0..n (gapless scheme).
// Consistent with the public store read order (Plan 27-04):
//   sort_order first, NULL/0 last, then name ascending.
// Threat T-27-07-04: validate id is integer, direction is "up"|"down".

type ReorderBody = { id: unknown; direction: unknown };
type TCategories = {
  name: string;
  id: number;
  sort_order: number | null;
}[];

// Fetch all categories ordered by sort_order then name (matches the shared rule).
async function getOrderedCategories() {
  const categories: TCategories = await prisma.category.findMany({
    select: { id: true, name: true, sort_order: true },
  });

  // Sort: null/0 → end, then name ascending (pt-BR locale)
  categories.sort((a, b) => {
    const aRank =
      a.sort_order == null || a.sort_order === 0 ? Infinity : a.sort_order;
    const bRank =
      b.sort_order == null || b.sort_order === 0 ? Infinity : b.sort_order;
    if (aRank !== bRank) return aRank - bRank;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return categories;
}

export async function POST(req: NextRequest) {
  const gate = await requireMaster(req);
  if (!gate.ok) {
    return NextResponse.json(gate.error, { status: gate.status });
  }

  let body: ReorderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Corpo da requisição inválido",
        code: "INVALID_BODY",
        retryable: false,
      },
      { status: 400 },
    );
  }

  // T-27-07-04: validate inputs
  const id =
    typeof body.id === "number" && Number.isInteger(body.id) && body.id > 0
      ? body.id
      : null;
  if (id === null) {
    return NextResponse.json(
      { error: "ID inválido", code: "INVALID_ID", retryable: false },
      { status: 400 },
    );
  }

  const direction = body.direction;
  if (direction !== "up" && direction !== "down") {
    return NextResponse.json(
      {
        error: "Direção inválida (use 'up' ou 'down')",
        code: "INVALID_DIRECTION",
        retryable: false,
      },
      { status: 400 },
    );
  }

  const ordered = await getOrderedCategories();
  const currentIndex = ordered.findIndex((c) => c.id === id);
  if (currentIndex === -1) {
    return NextResponse.json(
      {
        error: "Categoria não encontrada",
        code: "NOT_FOUND",
        retryable: false,
      },
      { status: 404 },
    );
  }

  // Calculate swap index
  const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (swapIndex < 0 || swapIndex >= ordered.length) {
    // Already at the boundary — no change needed, return current order as-is.
    return NextResponse.json({
      categories: ordered.map((c) => ({ id: c.id, sort_order: c.sort_order })),
    });
  }

  // Swap in the local array
  const temp = ordered[currentIndex];
  ordered[currentIndex] = ordered[swapIndex];
  ordered[swapIndex] = temp;

  // Re-normalize to 0..n (gapless scheme)
  const updates = ordered.map((c, index) =>
    prisma.category.update({
      where: { id: c.id },
      data: { sort_order: index },
    }),
  );

  await prisma.$transaction(updates);

  // Return the updated ordered list
  const result = ordered.map((c, index) => ({ id: c.id, sort_order: index }));
  return NextResponse.json({ categories: result });
}
