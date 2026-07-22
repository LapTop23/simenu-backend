# SI-Menu — Backend Architecture Guide

## 1. Repository Strategy

SI-Menu is delivered as a **split repository** (separate `si-menu-backend` and `si-menu-frontend`
repos), not a monorepo. Rationale:

- Independent deploy cadence — the backend (API/Render/Railway/EC2) and frontend
  (Vercel/Netlify/S3+CloudFront) scale and release on different schedules.
- Independent CI pipelines — no need for workspace tooling (Nx/Turborepo) at this stage;
  reintroduce a monorepo only once you have multiple internal packages to share (e.g. a shared
  TypeScript types package between admin dashboard, customer PWA, and API).
- Smaller blast radius — a frontend hotfix never risks a backend deploy and vice versa.

If a monorepo is later required (e.g. shared validation schemas), adopt this layout:

```
si-menu/
├── apps/
│   ├── backend/
│   └── frontend/
├── packages/
│   └── shared-types/
└── package.json (workspaces)
```

## 2. Backend Folder Structure

```
si-menu-backend/
├── server.js                  # Composition root — boots the HTTP server
├── package.json
├── .env.example
├── src/
│   ├── config/
│   │   └── db.js              # Mongoose connection lifecycle
│   ├── middleware/
│   │   ├── tenantResolver.js  # Tenant extraction + isolation guard
│   │   └── errorHandler.js    # Centralized error + 404 handling
│   ├── models/
│   │   ├── Restaurant.model.js
│   │   ├── MenuItem.model.js
│   │   └── Order.model.js
│   ├── controllers/
│   │   ├── restaurant.controller.js
│   │   ├── menu.controller.js
│   │   └── order.controller.js
│   ├── routes/
│   │   ├── restaurant.routes.js
│   │   ├── menu.routes.js
│   │   └── order.routes.js
│   └── utils/
│       ├── ApiError.js        # Uniform, HTTP-status-aware error class
│       ├── ApiResponse.js      # Uniform success-response envelope
│       └── asyncHandler.js    # Eliminates repetitive try/catch boilerplate
```

**Why this layering?** Routes stay declarative (path + middleware chain only), controllers hold
orchestration logic, models hold data-shape + persistence concerns, and middleware holds
cross-cutting concerns (tenant isolation, error normalization). This keeps tenant-isolation logic
in exactly *one* place instead of duplicated across every controller.

## 3. Multi-Tenant Isolation Strategy (Shared Database, Shared Collection)

SI-Menu uses the **"pooled" / "shared schema"** multi-tenancy model: all restaurants live in the
same MongoDB database and the same collections, but every tenant-owned document carries a
`restaurantId` field that is:

1. **Required** at the schema level (`required: true`) — a document cannot be saved without an owner.
2. **Indexed**, always as the *first* field in every compound index — MongoDB uses left-prefixing,
   so every tenant-scoped query (which always filters by `restaurantId`) hits an index.
3. **Injected server-side only.** The `restaurantId` never comes from the request body — it is
   resolved once by `tenantResolver` middleware from the public-facing slug (`?res=savory-foods`)
   and attached to `req.tenant`. Every controller then filters exclusively using `req.tenant.id`.
   This is the single most important rule preventing cross-tenant data leakage: **a client can
   never directly supply the database identifier used to scope a query.**

This model is chosen over "database-per-tenant" or "collection-per-tenant" because:
- SI-Menu tenants are numerous, small (a single restaurant's menu/orders), and need cheap
  onboarding (no per-tenant infrastructure provisioning).
- A single connection pool serves all tenants, which is far more resource-efficient at scale than
  thousands of individual DB connections.
- Cross-tenant aggregate reporting (e.g. platform-wide analytics for the SaaS operator) becomes a
  single query instead of a fan-out across databases.

The trade-off — a bug could theoretically leak data across tenants — is mitigated by centralizing
all tenant-scoping in the `tenantResolver` middleware and never trusting client-supplied IDs.
