import { PermissionKey } from "@prisma/client";

/**
 * The single list of permissions: what each one allows, how it is grouped on the Roles screen,
 * and whether it is sensitive (money, stock corrections, user and role administration).
 *
 *  - `sensitive` keys are never switched on automatically for existing roles; the owner ticks
 *    them deliberately.
 *  - `status: "planned"` keys are defined now so roles can be prepared, but no screen or endpoint
 *    enforces them until the named phase.
 *  - `deprecated` keys are kept so existing role settings stay valid, but nothing checks them
 *    any more (another key took over).
 */
export type PermissionInfo = {
  key: PermissionKey;
  /** Short name shown on the Roles screen. */
  label: string;
  group: string;
  description: string;
  sensitive: boolean;
  status: "active" | "planned";
  plannedPhase?: number;
  deprecated?: boolean;
};

type Spec = Omit<PermissionInfo, "key" | "label" | "status" | "sensitive"> & {
  sensitive?: boolean;
  status?: PermissionInfo["status"];
};

const P = PermissionKey;

const spec: Record<PermissionKey, Spec> = {
  // Products
  [P.PRODUCTS_VIEW]: { group: "Products", description: "See the product list, product details and categories." },
  [P.PRODUCTS_CREATE]: { group: "Products", description: "Add new products and upload product photos." },
  [P.PRODUCTS_EDIT]: { group: "Products", description: "Change product details, prices and reorder levels." },
  [P.PRODUCTS_DEACTIVATE]: { group: "Products", description: "Switch products off (hide them from selling).", sensitive: true },
  [P.PRODUCTS_EXPORT]: { group: "Products", description: "Download the product list as CSV, Excel or PDF." },
  [P.CATEGORIES_MANAGE]: { group: "Products", description: "Create, rename and delete categories." },
  [P.PRODUCT_TYPES_MANAGE]: { group: "Products", description: "Create, rename and delete product types." },
  [P.PRODUCTS_SELL]: { group: "Products", description: "Old key. Selling now needs “Record sales”.", deprecated: true },
  [P.PRODUCTS_RESTOCK]: { group: "Products", description: "Old key. Adding stock now needs “Receive stock”.", deprecated: true },
  [P.PRODUCTS_RESERVE]: { group: "Products", description: "Reserve stock for a customer from a product." },
  [P.PRICES_MANAGE]: { group: "Products", description: "Change prices in bulk and see price history.", sensitive: true },
  [P.LABELS_PRINT]: { group: "Products", description: "Print shelf and product labels." },

  // Stock
  [P.STOCK_VIEW]: { group: "Stock", description: "See stock levels, batches and the expiry list." },
  [P.STOCK_RECEIVE]: { group: "Stock", description: "Receive deliveries into stock." },
  [P.STOCK_HISTORY_VIEW]: { group: "Stock", description: "See the stock movement history." },
  [P.STOCK_ADJUST]: { group: "Stock", description: "Correct stock quantities by hand (counts, damage, loss).", sensitive: true },
  [P.STOCK_COUNT]: { group: "Stock", description: "Take part in stock counts." },
  [P.STOCK_COUNT_APPROVE]: { group: "Stock", description: "Approve large stock corrections and stock counts (also lets a manager approve with their PIN).", sensitive: true },
  [P.STOCK_TRANSFER]: { group: "Stock", description: "Move stock between locations." },
  [P.STOCK_WRITE_OFF]: { group: "Stock", description: "Write off expired or damaged stock.", sensitive: true },
  [P.LOCATIONS_MANAGE]: { group: "Stock", description: "Set up shelves, back store and other stock locations." },
  [P.RESERVATIONS_MANAGE]: { group: "Stock", description: "See, change, cancel and complete reservations." },

  // Sales
  [P.SALES_CREATE]: { group: "Sales", description: "Record sales." },
  [P.SALES_VIEW]: { group: "Sales", description: "Open the Sales page. Shows only your own sales unless “View all sales” is also on." },
  [P.SALES_VIEW_OWN]: { group: "Sales", description: "See the sales you recorded yourself." },
  [P.SALES_VIEW_ALL]: { group: "Sales", description: "See every sale, whoever recorded it." },
  [P.SALES_EXPORT]: { group: "Sales", description: "Download the sales list as CSV, Excel or PDF." },
  [P.SALES_VOID]: { group: "Sales", description: "Void a sale made earlier the same day.", sensitive: true, status: "planned", plannedPhase: 4 },
  [P.SALES_REFUND]: { group: "Sales", description: "Refund or take back a sale.", sensitive: true, status: "planned", plannedPhase: 4 },
  [P.DISCOUNT_APPLY]: { group: "Sales", description: "Give discounts within the allowed limit.", status: "planned", plannedPhase: 4 },
  [P.DISCOUNT_ABOVE_LIMIT]: { group: "Sales", description: "Give discounts above the normal limit (also lets a manager approve one with their PIN).", sensitive: true, status: "planned", plannedPhase: 4 },
  [P.PRICE_OVERRIDE]: { group: "Sales", description: "Change the price of an item during a sale.", sensitive: true, status: "planned", plannedPhase: 4 },

  // Cash and shifts
  [P.CASH_DRAWER_OPEN]: { group: "Cash and shifts", description: "Open the cash drawer without a sale.", sensitive: true, status: "planned", plannedPhase: 5 },
  [P.SHIFT_MANAGE]: { group: "Cash and shifts", description: "Open and close a shift and count the cash drawer.", status: "planned", plannedPhase: 5 },
  [P.SHIFT_VIEW_ALL]: { group: "Cash and shifts", description: "See every cashier's shifts and cash variances.", sensitive: true, status: "planned", plannedPhase: 5 },

  // Customers
  [P.CUSTOMERS_VIEW]: { group: "Customers", description: "See customers and their purchase history.", status: "planned", plannedPhase: 7 },
  [P.CUSTOMERS_MANAGE]: { group: "Customers", description: "Add and edit customers.", status: "planned", plannedPhase: 7 },
  [P.CUSTOMER_CREDIT_MANAGE]: { group: "Customers", description: "Give customers credit (pay later) and record repayments.", sensitive: true, status: "planned", plannedPhase: 7 },
  [P.PROMOTIONS_MANAGE]: { group: "Customers", description: "Create and edit promotions and coupons.", status: "planned", plannedPhase: 7 },

  // Purchasing
  [P.SUPPLIERS_MANAGE]: { group: "Purchasing", description: "Add and edit suppliers.", status: "planned", plannedPhase: 6 },
  [P.PURCHASING_MANAGE]: { group: "Purchasing", description: "Create purchase orders and receive against them.", status: "planned", plannedPhase: 6 },
  [P.PURCHASE_APPROVE]: { group: "Purchasing", description: "Approve large purchase orders.", sensitive: true, status: "planned", plannedPhase: 6 },
  [P.SUPPLIER_PAYMENTS_MANAGE]: { group: "Purchasing", description: "Record supplier bills and payments.", sensitive: true, status: "planned", plannedPhase: 6 },

  // Reports
  [P.REPORTING_VIEW]: { group: "Reports", description: "See the dashboard and sales reports (without cost and profit)." },
  [P.REPORTS_VIEW_COST_PROFIT]: { group: "Reports", description: "See what products cost and how much profit sales make.", sensitive: true },
  [P.EXPORTS_RUN]: { group: "Reports", description: "Run exports from report screens.", status: "planned", plannedPhase: 8 },

  // Administration
  [P.USERS_MANAGE]: { group: "Administration", description: "Add users, change their role, reset passwords.", sensitive: true },
  [P.ROLES_MANAGE]: { group: "Administration", description: "Change what each role is allowed to do.", sensitive: true },
  [P.SETTINGS_EMAILS]: { group: "Administration", description: "Choose who receives stock and expiry alert e-mails.", sensitive: true },
  [P.SETTINGS_MANAGE]: { group: "Administration", description: "Change shop settings such as approval limits.", sensitive: true },
  [P.AUDIT_VIEW]: { group: "Administration", description: "Read the audit log.", sensitive: true, status: "planned", plannedPhase: 9 },
};

const labels: Record<PermissionKey, string> = {
  [P.PRODUCTS_VIEW]: "View products",
  [P.PRODUCTS_CREATE]: "Add products",
  [P.PRODUCTS_EDIT]: "Edit products",
  [P.PRODUCTS_DEACTIVATE]: "Deactivate products",
  [P.PRODUCTS_EXPORT]: "Export products",
  [P.CATEGORIES_MANAGE]: "Manage categories",
  [P.PRODUCT_TYPES_MANAGE]: "Manage product types",
  [P.PRODUCTS_SELL]: "Sell products (old)",
  [P.PRODUCTS_RESTOCK]: "Restock products (old)",
  [P.PRODUCTS_RESERVE]: "Reserve stock",
  [P.PRICES_MANAGE]: "Manage prices",
  [P.LABELS_PRINT]: "Print labels",
  [P.STOCK_VIEW]: "View stock",
  [P.STOCK_RECEIVE]: "Receive stock",
  [P.STOCK_HISTORY_VIEW]: "View stock history",
  [P.STOCK_ADJUST]: "Adjust stock",
  [P.STOCK_COUNT]: "Count stock",
  [P.STOCK_COUNT_APPROVE]: "Approve stock corrections",
  [P.STOCK_TRANSFER]: "Transfer stock",
  [P.STOCK_WRITE_OFF]: "Write off stock",
  [P.LOCATIONS_MANAGE]: "Manage locations",
  [P.RESERVATIONS_MANAGE]: "Manage reservations",
  [P.SALES_CREATE]: "Record sales",
  [P.SALES_VIEW]: "Open the Sales page",
  [P.SALES_VIEW_OWN]: "View own sales",
  [P.SALES_VIEW_ALL]: "View all sales",
  [P.SALES_EXPORT]: "Export sales",
  [P.SALES_VOID]: "Void sales",
  [P.SALES_REFUND]: "Refund sales",
  [P.DISCOUNT_APPLY]: "Give discounts",
  [P.DISCOUNT_ABOVE_LIMIT]: "Give large discounts",
  [P.PRICE_OVERRIDE]: "Override prices",
  [P.CASH_DRAWER_OPEN]: "Open the cash drawer",
  [P.SHIFT_MANAGE]: "Manage own shift",
  [P.SHIFT_VIEW_ALL]: "View all shifts",
  [P.CUSTOMERS_VIEW]: "View customers",
  [P.CUSTOMERS_MANAGE]: "Manage customers",
  [P.CUSTOMER_CREDIT_MANAGE]: "Manage customer credit",
  [P.PROMOTIONS_MANAGE]: "Manage promotions",
  [P.SUPPLIERS_MANAGE]: "Manage suppliers",
  [P.PURCHASING_MANAGE]: "Manage purchasing",
  [P.PURCHASE_APPROVE]: "Approve purchases",
  [P.SUPPLIER_PAYMENTS_MANAGE]: "Manage supplier payments",
  [P.REPORTING_VIEW]: "View reports",
  [P.REPORTS_VIEW_COST_PROFIT]: "See cost and profit",
  [P.EXPORTS_RUN]: "Run exports",
  [P.USERS_MANAGE]: "Manage users",
  [P.ROLES_MANAGE]: "Manage roles",
  [P.SETTINGS_EMAILS]: "Manage alert e-mails",
  [P.SETTINGS_MANAGE]: "Manage shop settings",
  [P.AUDIT_VIEW]: "View the audit log",
};

export const PERMISSION_CATALOG: PermissionInfo[] = (Object.keys(spec) as PermissionKey[]).map((key) => ({
  key,
  label: labels[key],
  sensitive: false,
  status: "active",
  ...spec[key],
}));

export const GROUP_ORDER = [
  "Products",
  "Stock",
  "Sales",
  "Cash and shifts",
  "Customers",
  "Purchasing",
  "Reports",
  "Administration",
];

export const SENSITIVE_PERMISSIONS = new Set(PERMISSION_CATALOG.filter((p) => p.sensitive).map((p) => p.key));
