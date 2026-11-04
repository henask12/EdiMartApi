import { PermissionKey } from "@prisma/client";
import request from "supertest";
import { userWithPermissions } from "./access-helpers";
import {
  TestApp,
  bearer,
  close,
  createProduct,
  createTestApp,
  login,
  resetData,
  seedBasics,
} from "./helpers";

const K = PermissionKey;

describe("Phase 6 purchasing", () => {
  let t: TestApp;
  let locationId: string;
  let ownerToken: string;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => close(t));
  beforeEach(async () => {
    await resetData(t.prisma);
    const basics = await seedBasics(t.prisma);
    locationId = basics.location.id;
    ownerToken = await login(t, "owner@test.local");
  });

  it("supplier → PO → approve/send → receive raises stock; reorder creates draft; bill+payment", async () => {
    const { product } = await createProduct(t.prisma, locationId, {
      stock: 2,
      price: 100,
      cost: 40,
    });
    await t.prisma.product.update({
      where: { id: product.id },
      data: { maxStock: 20, restockQty: 10, leadTimeDays: 5 },
    });

    const before = await t.prisma.inventoryItem.findUniqueOrThrow({
      where: { productId_locationId: { productId: product.id, locationId } },
    });
    expect(before.quantityOnHand.toString()).toBe("2");

    const supplierRes = await request(t.http())
      .post("/suppliers")
      .set(bearer(ownerToken))
      .send({
        name: "Acme Traders",
        phone: "0911000000",
        telegram: "@acme",
        leadTimeDays: 7,
      });
    expect(supplierRes.status).toBe(201);
    const supplierId = supplierRes.body.id as string;

    const link = await request(t.http())
      .post(`/suppliers/${supplierId}/products`)
      .set(bearer(ownerToken))
      .send({ productId: product.id, supplierSku: "ACME-1", lastCost: "45", isPreferred: true });
    expect(link.status).toBe(201);
    expect(link.body.lastCost).toBe("45.00");
    expect(link.body.packSize).toBe(1);

    const history = await request(t.http())
      .get(`/suppliers/${supplierId}/products/${product.id}/cost-history`)
      .set(bearer(ownerToken));
    expect(history.status).toBe(200);
    expect(history.body.length).toBeGreaterThanOrEqual(1);

    const po = await request(t.http())
      .post("/purchase-orders")
      .set(bearer(ownerToken))
      .send({
        supplierId,
        lines: [{ productId: product.id, quantity: "10", unitCost: "45" }],
      });
    expect(po.status).toBe(201);
    expect(po.body.status).toBe("DRAFT");
    expect(po.body.poNumber).toMatch(/^PO-\d{8}-\d{4}$/);
    expect(po.body.subtotal).toBe("450.00");
    const poId = po.body.id as string;
    const poLineId = po.body.lines[0].id as string;

    const approved = await request(t.http())
      .post(`/purchase-orders/${poId}/approve`)
      .set(bearer(ownerToken))
      .send({});
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("APPROVED");

    const sent = await request(t.http())
      .post(`/purchase-orders/${poId}/send`)
      .set(bearer(ownerToken))
      .send({});
    expect(sent.status).toBe(201);
    expect(sent.body.purchaseOrder.status).toBe("SENT");
    expect(sent.body.document.poNumber).toBe(po.body.poNumber);
    expect(sent.body.channels.telegram.status).toBe("STUB");

    const incoming = await request(t.http())
      .get(`/purchasing/incoming?productId=${product.id}`)
      .set(bearer(ownerToken));
    expect(incoming.status).toBe(200);
    expect(Number(incoming.body.incoming)).toBe(10);

    const lookup = await request(t.http())
      .get(`/inventory/lookup?q=${encodeURIComponent(product.sku)}`)
      .set(bearer(ownerToken));
    expect(lookup.status).toBe(200);
    expect(Number(lookup.body.incoming)).toBe(10);

    const gr = await request(t.http())
      .post("/goods-receipts")
      .set(bearer(ownerToken))
      .send({
        purchaseOrderId: poId,
        lines: [
          {
            purchaseOrderLineId: poLineId,
            productId: product.id,
            quantity: "10",
            unitCost: "45",
            locationId,
          },
        ],
      });
    expect(gr.status).toBe(201);
    expect(gr.body.receiptNumber).toMatch(/^GR-\d{8}-\d{4}$/);
    expect(gr.body.lines[0].unitCost).toBe("45.00");

    const after = await t.prisma.inventoryItem.findUniqueOrThrow({
      where: { productId_locationId: { productId: product.id, locationId } },
    });
    expect(after.quantityOnHand.toString()).toBe("12");
    expect(Number(after.averageCost)).toBeGreaterThan(0);

    const poAfter = await request(t.http())
      .get(`/purchase-orders/${poId}`)
      .set(bearer(ownerToken));
    expect(poAfter.status).toBe(200);
    expect(poAfter.body.status).toBe("RECEIVED");
    expect(Number(poAfter.body.lines[0].quantityReceived)).toBe(10);

    const movement = await t.prisma.stockMovement.findFirst({
      where: { type: "RECEIPT", refType: "GOODS_RECEIPT", refId: gr.body.id },
    });
    expect(movement).toBeTruthy();
    const audit = await t.prisma.auditLog.findFirst({
      where: { action: "GOODS_RECEIPT", entityId: gr.body.id },
    });
    expect(audit).toBeTruthy();

    const suggestions = await request(t.http())
      .get("/purchasing/reorder-suggestions")
      .set(bearer(ownerToken));
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.seasonalityUplift).toBe(false);
    const row = suggestions.body.items.find((i: { productId: string }) => i.productId === product.id);
    expect(row).toBeTruthy();
    expect(row.supplierId).toBe(supplierId);

    const draftFromReorder = await request(t.http())
      .post("/purchasing/reorder-suggestions/create-pos")
      .set(bearer(ownerToken))
      .send({
        supplierId,
        lines: [{ productId: product.id, quantity: "5" }],
      });
    expect(draftFromReorder.status).toBe(201);
    expect(draftFromReorder.body.status).toBe("DRAFT");
    expect(draftFromReorder.body.supplierId).toBe(supplierId);

    const bill = await request(t.http())
      .post("/supplier-bills")
      .set(bearer(ownerToken))
      .send({
        supplierId,
        purchaseOrderId: poId,
        goodsReceiptIds: [gr.body.id],
        amountDue: "450",
        dueDate: new Date().toISOString(),
      });
    expect(bill.status).toBe(201);
    expect(bill.body.billNumber).toMatch(/^BILL-\d{8}-\d{4}$/);
    expect(bill.body.status).toBe("OPEN");

    const pay = await request(t.http())
      .post(`/supplier-bills/${bill.body.id}/payments`)
      .set(bearer(ownerToken))
      .send({ amount: "200", method: "CASH" });
    expect(pay.status).toBe(201);
    expect(pay.body.status).toBe("PARTIAL");
    expect(pay.body.amountPaid).toBe("200.00");

    const payRest = await request(t.http())
      .post(`/supplier-bills/${bill.body.id}/payments`)
      .set(bearer(ownerToken))
      .send({ amount: "250", method: "BANK_TRANSFER" });
    expect(payRest.status).toBe(201);
    expect(payRest.body.status).toBe("PAID");

    const aged = await request(t.http())
      .get("/supplier-bills/aged-payables")
      .set(bearer(ownerToken));
    expect(aged.status).toBe(200);
    expect(aged.body.asOf).toBeTruthy();
  });

  it("PO above threshold requires PURCHASE_APPROVE for non-owner", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 1, cost: 50 });
    const supplier = await t.prisma.supplier.create({
      data: { name: "Big Co", currency: "ETB" },
    });
    const buyer = await userWithPermissions(t, [K.PURCHASING_MANAGE], "buyer");

    const po = await request(t.http())
      .post("/purchase-orders")
      .set(bearer(buyer.token))
      .send({
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: "300", unitCost: "50" }],
      });
    expect(po.status).toBe(201);
    expect(Number(po.body.subtotal)).toBe(15000);

    const denied = await request(t.http())
      .post(`/purchase-orders/${po.body.id}/approve`)
      .set(bearer(buyer.token))
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("PURCHASE_APPROVE_REQUIRED");

    const approver = await userWithPermissions(
      t,
      [K.PURCHASING_MANAGE, K.PURCHASE_APPROVE],
      "approver",
    );
    const ok = await request(t.http())
      .post(`/purchase-orders/${po.body.id}/approve`)
      .set(bearer(approver.token))
      .send({});
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("APPROVED");
  });

  it("hides unitCost on PO without REPORTS_VIEW_COST_PROFIT", async () => {
    const { product } = await createProduct(t.prisma, locationId, { stock: 1, cost: 40 });
    const supplier = await t.prisma.supplier.create({
      data: { name: "Cost Hide Co", currency: "ETB" },
    });
    const po = await request(t.http())
      .post("/purchase-orders")
      .set(bearer(ownerToken))
      .send({
        supplierId: supplier.id,
        lines: [{ productId: product.id, quantity: "2", unitCost: "40" }],
      });
    expect(po.status).toBe(201);

    const staff = await userWithPermissions(t, [K.PURCHASING_MANAGE], "po-viewer");
    const res = await request(t.http())
      .get(`/purchase-orders/${po.body.id}`)
      .set(bearer(staff.token));
    expect(res.status).toBe(200);
    expect(res.body.lines[0].unitCost).toBeUndefined();
    expect(res.body.subtotal).toBe("80.00");
  });
});
