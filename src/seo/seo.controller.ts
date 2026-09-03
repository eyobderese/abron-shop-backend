import { Controller, Get, Header } from '@nestjs/common';
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

function sitemapEntry(location: string, lastModified?: Date) {
  const lastmod = lastModified
    ? `<lastmod>${lastModified.toISOString()}</lastmod>`
    : '';
  return `<url><loc>${xmlEscape(location)}</loc>${lastmod}</url>`;
}

@Controller('seo')
export class SeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=3600')
  async sitemap() {
    const siteUrl = String(
      this.config.get('PUBLIC_SITE_URL') ?? 'https://abronshop.online',
    ).replace(/\/+$/, '');

    const [categories, products] = await Promise.all([
      this.prisma.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.product.findMany({
        select: { id: true, updatedAt: true },
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
        ),
      ),
      ...products.map((product) =>
        sitemapEntry(
          `${siteUrl}/product/${encodeURIComponent(product.id)}`,
          product.updatedAt,
        ),
      ),
    ];

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      '</urlset>',
    ].join('');
  }
}
