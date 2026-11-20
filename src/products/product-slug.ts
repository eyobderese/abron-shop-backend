import { PrismaService } from '../database/prisma.service';

// New slugs are kept short so product links are easy to share and read well in
// search results. Older products may have slugs up to 180 characters; those keep
// working (see maxParamLength in main.ts) so existing links never break.
const MAX_SLUG_LENGTH = 80;

/** Cut to `max` characters without leaving half a word at the end. */
function trimToWord(slug: string, max: number) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  // Only back up to the previous word if that doesn't throw away too much.
  return (lastDash >= max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '');
}

export function slugifyProductName(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return trimToWord(slug, MAX_SLUG_LENGTH) || 'product';
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
    const candidate = `${trimToWord(base, MAX_SLUG_LENGTH - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }

  throw new Error('Could not generate a unique product slug');
}
