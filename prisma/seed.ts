import {
  PrismaClient,
  RoleName,
  PaymentMethod,
  MovementType,
  type Product,
} from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS } from "../src/permissions";
import * as bcrypt from "bcryptjs";
import { CATALOG_CATEGORIES, CATALOG_PRODUCTS } from "./catalog-seed-data";

const prisma = new PrismaClient();

const hash = (password: string) => bcrypt.hash(password, 10);

const autoSku = (name: string) =>
  `auto-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`;

const PRODUCT_TYPES = ["Food", "Beverage", "Merchandise", "Beauty"] as const;

const typeForCategory = (category: string): string => {
  if (category === "Snacks") return "Food";
  if (category === "Skincare" || category === "Cosmetics" || category === "Personal Care" || category === "Health & Vitamins") {
    return "Beauty";
  }
  return "Merchandise";
};

const main = async () => {
  const roles = await Promise.all(
    (Object.keys(RoleName) as (keyof typeof RoleName)[]).map(async (key) => {
      const name = RoleName[key];
      return prisma.role.upsert({
        where: { name },
        update: { isProtected: name === RoleName.OWNER },
        create: { name, isProtected: name === RoleName.OWNER },
      });
    }),
  );

  const roleByName = (n: RoleName) => roles.find((r) => r.name === n)!;

  for (const role of roles) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role.name];
    for (const permission of defaults) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permission: { roleId: role.id, permission },
        },
        update: {},
        create: { roleId: role.id, permission },
      });
    }
  }

  const defaultLoc = await prisma.location.upsert({
    where: { code: "DEFAULT_STORE" },
    update: {},
    create: { code: "DEFAULT_STORE", name: "Main Store" },
  });

  const categoryByName = new Map<string, { id: string; name: string }>();
  for (const name of CATALOG_CATEGORIES) {
    const cat = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    categoryByName.set(name, cat);
  }

  const typeByName = new Map<string, { id: string; name: string }>();
  for (const name of PRODUCT_TYPES) {
    const pt = await prisma.productType.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    typeByName.set(name, pt);
  }

  const ownerRole = roleByName(RoleName.OWNER);
  const cashierRole = roleByName(RoleName.CASHIER);
  const staffRole = roleByName(RoleName.STORE_STAFF);

  await prisma.user.upsert({
    where: { email: "owner@edisims.local" },
    update: {},
    create: {
      email: "owner@edisims.local",
      displayName: "Shop Owner",
      passwordHash: await hash("Owner123!"),
      roleId: ownerRole.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "cashier@edisims.local" },
    update: {},
    create: {
      email: "cashier@edisims.local",
      displayName: "Helper",
      passwordHash: await hash("Cashier123!"),
      roleId: cashierRole.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "staff@edisims.local" },
    update: {},
    create: {
      email: "staff@edisims.local",
      displayName: "Staff",
      passwordHash: await hash("Staff123!"),
      roleId: staffRole.id,
    },
  });

  const products: Product[] = [];
  for (const p of CATALOG_PRODUCTS) {
    const category = categoryByName.get(p.category);
    if (!category) {
      throw new Error(`Missing category: ${p.category}`);
    }
    const costPrice = p.costPrice ?? 0;
    const qty = p.initialQuantity ?? 0;
    const productType = typeByName.get(typeForCategory(p.category));
    const product = await prisma.product.upsert({
      where: {
        categoryId_name: { categoryId: category.id, name: p.name },
      },
      update: {
        categoryId: category.id,
        sellingPrice: p.sellingPrice,
        costPrice,
        restockAt: p.restockAt ?? 0,
        restockQty: p.restockQty ?? 0,
        description: p.description ?? null,
        originCountry: p.originCountry ?? null,
        productTypeId: productType?.id ?? null,
      },
      create: {
        sku: autoSku(p.name),
        name: p.name,
        categoryId: category.id,
        productTypeId: productType?.id ?? null,
        sellingPrice: p.sellingPrice,
        costPrice,
        restockAt: p.restockAt ?? 0,
        restockQty: p.restockQty ?? 0,
        description: p.description ?? null,
        originCountry: p.originCountry ?? null,
      },
    });
    products.push(product);

    await prisma.inventoryItem.upsert({
      where: {
        productId_locationId: { productId: product.id, locationId: defaultLoc.id },
      },
      update: {
        quantityOnHand: qty,
        averageCost: costPrice,
      },
      create: {
        productId: product.id,
        locationId: defaultLoc.id,
        quantityOnHand: qty,
        averageCost: costPrice,
      },
    });
  }

  const water = products.find((p) => p.name.includes("Irish")) ?? products[0]!;
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@edisims.local" },
  });

  await prisma.notificationEmail.upsert({
    where: { email: "owner@edisims.local" },
    update: { active: true },
    create: { email: "owner@edisims.local", active: true },
  });

  const existingSale = await prisma.sale.findUnique({
    where: { saleNumber: "SEED-0001" },
  });

  if (!existingSale) {
    const waterInv = await prisma.inventoryItem.findFirstOrThrow({
      where: { productId: water.id, locationId: defaultLoc.id },
    });

    const before = waterInv.quantityOnHand;
    if (before.lt(2)) {
      console.log("Seed sale skipped — insufficient stock on demo product.");
    } else {
    const after = before.sub(2);

    const unitPrice = 400;
    const lineTotal = 800;
    const sale = await prisma.sale.create({
      data: {
        saleNumber: "SEED-0001",
        subtotal: lineTotal,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: lineTotal,
        createdByUserId: owner.id,
        lines: {
          create: [
            {
              productId: water.id,
              quantity: 2,
              unitPrice,
              lineDiscount: 0,
              taxAmount: 0,
              lineTotal,
            },
          ],
        },
        payments: {
          create: [{ method: PaymentMethod.CASH, amount: lineTotal }],
        },
      },
    });

    await prisma.stockMovement.create({
      data: {
        inventoryItemId: waterInv.id,
        type: MovementType.SALE,
        qtyDelta: -2,
        beforeOnHand: before,
        afterOnHand: after,
        refType: "SALE",
        refId: sale.id,
        createdByUserId: owner.id,
      },
    });

    await prisma.inventoryItem.update({
      where: { id: waterInv.id },
      data: { quantityOnHand: after },
    });
    }
  }

  console.log("Seed complete.");
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
