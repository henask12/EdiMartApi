# Permissions (Phase 1: one permission model)

Every route answers one question the same way: **does this person's role hold the permission?**
There is no other rule. Role names (`CASHIER`, `STORE_STAFF`...) mean nothing to the code; only the
**OWNER** role bypasses checks.

## The rules

1. A role is a bundle of permissions stored in the database (`RolePermission`). A role has exactly
   what is stored for it. There is no fallback to defaults in code (there used to be: a built-in
   role with every box unticked quietly got its defaults back).
2. Every route declares one of:
   - `@RequirePermissions(a, b)` — needs **all** of them
   - `@RequireAnyPermission(a, b)` — needs **at least one**
   - `@AnyAuthenticated()` — any signed-in user (only their own profile, password, PIN, and the
     approval picker)
   - `@Public()` — no sign-in (login, health, signed file links, the optional setup routes)
3. A route that declares nothing is refused at run time **and the API will not start**
   (`PermissionCoverageService`). `test/permissions.e2e-spec.ts` also checks every route twice: a
   user with no permissions is refused, and a user with exactly the required permission(s) gets
   through authorisation.
4. **Nobody can hand out more than they hold.** Editing roles or users needs `ROLES_MANAGE` /
   `USERS_MANAGE`, but a non-owner can only grant permissions they have themselves, cannot edit their
   own role, cannot assign the owner role, and cannot edit or reset the password of someone whose role
   is stronger than theirs. (Before this, anyone who could manage users could create an owner.)

## Where the permissions live

`src/permissions/permission-catalog.ts` is the single list: key, short label, plain-language
description, group, and whether it is **sensitive** (money, stock corrections, user/role admin). The
Roles screen reads it from `GET /roles/permissions`. It is a compile-time-complete map, so adding a
key to the Prisma enum without describing it fails the build.

- `status: "planned"` keys exist so roles can be prepared; nothing enforces them until that phase.
- `deprecated` keys (`PRODUCTS_SELL`, `PRODUCTS_RESTOCK`) are kept so old role settings stay valid;
  selling now needs `SALES_CREATE` and adding stock needs `STOCK_RECEIVE`.
- Sensitive keys are never switched on automatically by a migration or backfill.

## Who sees which sales

`SALES_VIEW` opens the Sales page. Without `SALES_VIEW_ALL` a person sees only the sales they recorded
(list, detail and exports; someone else's sale looks like it does not exist). `SALES_VIEW_OWN` means
the same without the old key. The backfill gave every role that had `SALES_VIEW` the key
`SALES_VIEW_ALL` as well, so nobody lost access.

## Cost and profit

`REPORTS_VIEW_COST_PROFIT` is required to see what products cost or what sales earn, **in the API
response itself**: product cost price and per-stock-row average cost, sale line cost and net profit,
the profit and stock-value figures on the dashboard and report summaries, stock-movement and batch
unit costs, and the "Cost" / "Net profit" export columns. Changing a product's cost price needs the
same permission. Receiving stock still accepts a unit cost (write-only).
`test/cost-visibility.e2e-spec.ts` scans every response at every depth for a list of cost field names,
so a new endpoint that leaks one fails the test.

## Manager approval (PIN)

- A user can set a 4–6 digit PIN (`PUT /auth/pin`, needs their password; repeated digits and straight
  runs are refused). Only a bcrypt hash is stored.
- `POST /approvals` — a signed-in person (e.g. a cashier) names a manager and enters the manager's PIN
  for one **action**. The manager must hold the permission that action needs:

  | Action | Manager needs | Used today |
  |---|---|---|
  | `STOCK_ADJUST_OVER_LIMIT` | `STOCK_COUNT_APPROVE` | yes: `POST /inventory/adjust` |
  | `DISCOUNT_OVER_LIMIT` | `DISCOUNT_ABOVE_LIMIT` | Phase 4 |
  | `PRICE_OVERRIDE` | `PRICE_OVERRIDE` | Phase 4 |
  | `SALE_VOID` | `SALES_VOID` | Phase 4 |
  | `REFUND_OUTSIDE_WINDOW` | `SALES_REFUND` | Phase 4 |
  | `NO_SALE_DRAWER_OPEN` | `CASH_DRAWER_OPEN` | Phase 5 |

- Five wrong PINs lock that manager's PIN for 15 minutes. The attempt is counted *before* the PIN is
  checked, so parallel guessing cannot get extra tries. A manager cannot approve their own request.
- The result is a **single-use token** valid for 2 minutes, for one action and one requesting user,
  sent as `X-Approval-Token`. Only its hash is stored. It is consumed inside the action's own
  transaction, so a failed action does not use it up. The approving manager is written to the audit
  log (`approvedByUserId`).
- `GET /approvals/managers?action=…` lists who could approve (active, has a PIN, holds the permission,
  never the requester).

### Large stock corrections

`POST /inventory/adjust` needs `STOCK_ADJUST`. If the correction is worth more than the limit
(|quantity| × average cost, falling back to the product's cost price; **default Br 5,000**), the
caller needs `STOCK_COUNT_APPROVE` or an approval token; otherwise the API answers `403` with
`code: "APPROVAL_REQUIRED"`, the value and the limit. The limit is the shop setting
`inventory.adjustmentApprovalThreshold`, changed with `PATCH /settings/store` (needs
`SETTINGS_MANAGE`). There is no screen for it yet (settings screens arrive in Phase 2).

## Adding a route (checklist)

1. Pick the permission from the catalog (or add one: enum + migration + catalog entry + label).
2. Put the decorator on the handler.
3. If the response contains cost or profit, take `viewerFor(req.user).includeCost` and leave the
   fields out when it is false.
4. Add the route to the table in `test/permissions.e2e-spec.ts`.

## Existing databases

Migration `20251105000100_phase1_permissions_backfill` writes the old code defaults out as real rows
for built-in roles that had none, and gives `SALES_VIEW_ALL` / `STOCK_VIEW` to roles that had the
equivalent old key. `test/backfill.e2e-spec.ts` builds a database in its pre-Phase-1 state and checks
that nothing else changes and no sensitive key appears.
