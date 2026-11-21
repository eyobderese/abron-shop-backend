import { BadRequestException } from '@nestjs/common';
import { activeFlashDeal, effectivePrice, flashDealJson, validateFlashDeal } from './flash-deal';

const now = new Date('2026-11-21T12:00:00Z');
const hour = 3_600_000;
const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * hour);

describe('flash deals', () => {
  const base = { price: 20000, flashPrice: 15000, flashStartsAt: null, flashEndsAt: at(3) };

  it('is active between start and end', () => {
    expect(activeFlashDeal(base, now)?.price).toBe(15000);
    expect(effectivePrice(base, now)?.toNumber()).toBe(15000);
  });

  it('is not active before it starts or after it ends', () => {
    expect(activeFlashDeal({ ...base, flashStartsAt: at(1) }, now)).toBeNull();
    expect(activeFlashDeal({ ...base, flashEndsAt: at(-1) }, now)).toBeNull();
    expect(effectivePrice({ ...base, flashEndsAt: at(-1) }, now)?.toNumber()).toBe(20000);
  });

  it('ignores a flash price that is not lower than the normal price', () => {
    expect(activeFlashDeal({ ...base, flashPrice: 20000 }, now)).toBeNull();
  });

  it('reports seconds left and percent off', () => {
    const json = flashDealJson(base, now);
    expect(json?.ends_in_seconds).toBe(3 * 3600);
    expect(json?.percent_off).toBe(25);
  });

  it('rejects deals that could never show', () => {
    const ok = { price: 20000, flashPrice: 15000, flashStartsAt: null, flashEndsAt: at(3) };
    expect(() => validateFlashDeal(ok)).not.toThrow();
    expect(() => validateFlashDeal({ ...ok, flashPrice: null, flashEndsAt: null })).not.toThrow();
    expect(() => validateFlashDeal({ ...ok, flashEndsAt: null })).toThrow(BadRequestException);
    expect(() => validateFlashDeal({ ...ok, flashPrice: 25000 })).toThrow(BadRequestException);
    expect(() => validateFlashDeal({ ...ok, flashStartsAt: at(4) })).toThrow(BadRequestException);
  });
});
