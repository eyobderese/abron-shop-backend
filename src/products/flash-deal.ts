import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export type FlashFields = {
  price: DecimalLike;
  flashPrice?: DecimalLike;
  flashStartsAt?: Date | null;
  flashEndsAt?: Date | null;
};

const num = (value: DecimalLike) =>
  value === null || value === undefined ? null : Number(value.toString());

/** The running flash deal for a product, or null when there is none right now. */
export function activeFlashDeal(row: FlashFields, now = new Date()) {
  const flashPrice = num(row.flashPrice);
  const price = num(row.price);
  if (flashPrice === null || !row.flashEndsAt) return null;
  if (row.flashEndsAt <= now) return null;
  if (row.flashStartsAt && row.flashStartsAt > now) return null;
  if (price !== null && flashPrice >= price) return null;
  return { price: flashPrice, regularPrice: price, startsAt: row.flashStartsAt ?? null, endsAt: row.flashEndsAt };
}

/** The price a customer gets right now: the flash price while a deal runs, otherwise the normal price. */
export function effectivePrice<T extends FlashFields>(row: T, now = new Date()): Prisma.Decimal | null {
  const deal = activeFlashDeal(row, now);
  if (deal) return new Prisma.Decimal(deal.price);
  return row.price === null || row.price === undefined ? null : new Prisma.Decimal(row.price.toString());
}

/** Public JSON for a product's flash deal. `ends_in_seconds` lets the browser count down even if the phone clock is wrong. */
export function flashDealJson(row: FlashFields, now = new Date()) {
  const deal = activeFlashDeal(row, now);
  if (!deal) return null;
  return {
    price: deal.price,
    regular_price: deal.regularPrice,
    percent_off:
      deal.regularPrice ? Math.round(((deal.regularPrice - deal.price) / deal.regularPrice) * 100) : null,
    starts_at: deal.startsAt,
    ends_at: deal.endsAt,
    ends_in_seconds: Math.max(0, Math.floor((deal.endsAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Rejects a flash deal that could never show correctly. Pass the values the product will have after saving. */
export function validateFlashDeal(values: {
  price: DecimalLike;
  flashPrice: DecimalLike;
  flashStartsAt: Date | null;
  flashEndsAt: Date | null;
}) {
  const flashPrice = num(values.flashPrice);
  if (flashPrice === null) return;
  const price = num(values.price);
  if (!values.flashEndsAt) {
    throw new BadRequestException('Choose when the flash deal ends');
  }
  if (price !== null && flashPrice >= price) {
    throw new BadRequestException('The flash deal price must be lower than the normal price');
  }
  if (values.flashStartsAt && values.flashStartsAt >= values.flashEndsAt) {
    throw new BadRequestException('The flash deal must end after it starts');
  }
}
