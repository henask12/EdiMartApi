"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productStockSnapshot = exports.getReservedQty = void 0;
const client_1 = require("@prisma/client");
const getReservedQty = async (prisma, productId) => {
    const agg = await prisma.reservation.aggregate({
        where: { productId, status: client_1.ReservationStatus.RESERVED },
        _sum: { quantity: true },
    });
    return agg._sum.quantity ?? new client_1.Prisma.Decimal(0);
};
exports.getReservedQty = getReservedQty;
const productStockSnapshot = async (prisma, productId, locationId) => {
    const inv = await prisma.inventoryItem.findUnique({
        where: { productId_locationId: { productId, locationId } },
    });
    const onHand = inv?.quantityOnHand ?? new client_1.Prisma.Decimal(0);
    const reserved = await (0, exports.getReservedQty)(prisma, productId);
    const available = onHand.sub(reserved);
    return { inv, onHand, reserved, available };
};
exports.productStockSnapshot = productStockSnapshot;
//# sourceMappingURL=stock.util.js.map