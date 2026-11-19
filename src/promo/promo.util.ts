import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** Last 9 digits of a phone number, so +251 911 223344 and 0911223344 match. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export function normalizeCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** "Abebe Kebede" -> "Abebe K." */
export function maskName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  const first = parts[0];
  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : '';
  return `${first}${lastInitial}`;
}

/** "+251911223344" -> "+2519••••44" */
export function maskPhone(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, '');
  if (compact.length <= 6) return '••••';
  return `${compact.slice(0, compact.startsWith('+') ? 5 : 4)}••••${compact.slice(-2)}`;
}

export function money(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatAmount(value: Prisma.Decimal | number | null | undefined, currency = 'ETB') {
  const n = money(value);
  return n === null ? 'not set' : `${n.toLocaleString('en-US')} ${currency}`;
}
