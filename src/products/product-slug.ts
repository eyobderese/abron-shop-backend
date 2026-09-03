import { PrismaService } from '../database/prisma.service';

const MAX_SLUG_LENGTH = 180;

export function slugifyProductName(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug || 'product';
}

export async function uniqueProductSlug(
  prisma: PrismaService,
  productName: string,
) {
  const base = slugifyProductName(productName);
  const existing = await prisma.product.findMany({
    where: {
      OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }],
    },
    select: { slug: true },
  });
  const used = new Set(existing.map((product) => product.slug));

  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }

  throw new Error('Could not generate a unique product slug');
}
