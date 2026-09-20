// Admin category proxy helpers — master-scope checked forwarding to the Python
// backend category endpoints (STORE-06, D-11/D-14).
//
// This module is the thin, named entry point that Plan 27-07 declares as the
// artifact for category CRUD proxy helpers. The actual implementations live in
// `src/lib/admin-proxy.ts` (shared with the product/option proxies, so the
// master-scope gate, standard error shape, and backendFetch all stay DRY).
// Re-exporting here keeps the single-source-of-truth for the proxy primitives
// while exposing the contractually-named module.
//
// Design (Phase 27 D-11/D-14):
//   * Category create/update/delete MUST run in Python (single-writer):
//     name uniqueness, validation live in `Backend/app/store/categories`.
//   * Every helper enforces the master scope gate (D-15) server-side BEFORE
//     forwarding (T-27-07-01). Python's own `require_master_full_access`
//     re-validates via the forwarded auth cookie (defense in depth).
//   * Python's product-reference delete guard (D-14) is preserved — Next
//     propagates the 400 so the UI shows the guard message.

export {
  proxyCategoryCreate,
  proxyCategoryUpdate,
  proxyCategoryDelete,
} from "./admin-proxy";
export type { ProxyCategoryResponse } from "./admin-proxy";