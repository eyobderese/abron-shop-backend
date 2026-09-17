import { Controller, Get, Header, NotFoundException, Param, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sitemapEntry(
  location: string,
  lastModified?: Date,
  imageLocations: string[] = [],
) {
  const lastmod = lastModified
    ? `<lastmod>${lastModified.toISOString()}</lastmod>`
    : '';
  const images = imageLocations
    .filter(Boolean)
    .slice(0, 1000)
    .map((imageLocation) =>
      `<image:image><image:loc>${xmlEscape(imageLocation)}</image:loc></image:image>`,
    )
    .join('');
  return `<url><loc>${xmlEscape(location)}</loc>${lastmod}${images}</url>`;
}

@Controller('seo')
export class SeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private siteUrl() {
    return String(
      this.config.get('PUBLIC_SITE_URL') ?? 'https://abronshop.online',
    ).replace(/\/+$/, '');
  }

  @Get('product-redirect/:id')
  @Redirect('https://abronshop.online', 301)
  async redirectLegacyProduct(@Param('id') id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException();
    }
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { slug: true },
    });
    if (!product) throw new NotFoundException();
    return {
      url: `${this.siteUrl()}/products/${encodeURIComponent(product.slug)}`,
      statusCode: 301,
    };
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=3600')
  async sitemap() {
    const siteUrl = this.siteUrl();

    const [categories, products] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true, imageUrl: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.product.findMany({
        select: { slug: true, updatedAt: true, images: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const entries = [
      sitemapEntry(`${siteUrl}/`),
      sitemapEntry(`${siteUrl}/categories`),
      ...categories.map((category) =>
        sitemapEntry(
          `${siteUrl}/category/${encodeURIComponent(category.slug)}`,
          category.updatedAt,
          category.imageUrl ? [category.imageUrl] : [],
        ),
      ),
      ...products.map((product) =>
        sitemapEntry(
          `${siteUrl}/products/${encodeURIComponent(product.slug)}`,
          product.updatedAt,
          product.images,
        ),
      ),
    ];

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      ...entries,
      '</urlset>',
    ].join('');
  }
}
