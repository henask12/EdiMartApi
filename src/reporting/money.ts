import { Prisma } from "@prisma/client";

export const D0 = () => new Prisma.Decimal(0);

export const asMoney = (v: Prisma.Decimal | number | string): string =>
  new Prisma.Decimal(v).toFixed(2);

export const asQty = (v: Prisma.Decimal | number | string): string =>
  new Prisma.Decimal(v).toString();

export const toNumber = (v: Prisma.Decimal | number | string): number =>
  Number(new Prisma.Decimal(v).toString());
