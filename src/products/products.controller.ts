import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { productJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { MediaService } from '../media/media.service';
import { CreateProductDto, UpdateProductDto } from './products.dto';
import { uniqueProductSlug } from './product-slug';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function productMediaUrls(row: { images: string[]; imageViews: unknown }) {
  const viewUrls = Array.isArray(row.imageViews)
    ? row.imageViews.flatMap((view) =>
        view && typeof view === 'object' && !Array.isArray(view) &&
        typeof (view as { url?: unknown }).url === 'string'
          ? [(view as { url: string }).url]
          : [],
      )
    : [];
  return [...row.images, ...viewUrls];
}

function productData(dto: CreateProductDto | UpdateProductDto) {
  return {
    ...(dto.name !== undefined && { name: dto.name }),
    ...(dto.name_am !== undefined && { nameAm: dto.name_am || null }),
    ...(dto.name_or !== undefined && { nameOr: dto.name_or || null }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.description_am !== undefined && { descriptionAm: dto.description_am || null }),
    ...(dto.description_or !== undefined && { descriptionOr: dto.description_or || null }),
    ...(dto.category_id !== undefined && { categoryId: dto.category_id }),
    ...(dto.brand !== undefined && { brand: dto.brand || null }),
    ...(dto.price !== undefined && { price: dto.price }),
    ...(dto.was_price !== undefined && { wasPrice: dto.was_price }),
    ...(dto.currency !== undefined && { currency: dto.currency }),
    ...(dto.images !== undefined && { images: dto.images }),
    ...(dto.image_views !== undefined && { imageViews: dto.image_views as any }),
    ...(dto.in_stock !== undefined && { inStock: dto.in_stock }),
  };
}

@Controller()
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private async list(query: { categoryIds?: string; search?: string; limit?: string }) {
    const categoryIds = query.categoryIds?.split(',').filter(Boolean) ?? [];
    const tokens = query.search?.trim().split(/\s+/).filter(Boolean).slice(0, 8) ?? [];
    const where: Prisma.ProductWhereInput = {
      ...(categoryIds.length && { categoryId: { in: categoryIds } }),
      ...(tokens.length && {
        AND: tokens.map((token) => ({
          OR: ['name', 'nameAm', 'nameOr', 'description', 'descriptionAm', 'descriptionOr'].map((field) => ({
            [field]: { contains: token, mode: 'insensitive' },
          })),
        })),
      }),
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(query.limit) || 100, 1), 100),
    });
    return rows.map(productJson);
  }

  @Get('products')
  listPublic(@Query() query: { categoryIds?: string; search?: string; limit?: string }) {
    return this.list(query);
  }

  @Get('products/:identifier')
  async getOne(@Param('identifier') identifier: string) {
    const where = UUID_PATTERN.test(identifier)
      ? { id: identifier }
      : { slug: identifier.toLowerCase() };
    const row = await this.prisma.product.findUnique({ where, include: { category: true } });
    if (!row) throw new NotFoundException('Product not found');
    return productJson(row);
  }

  @Get('admin/products')
  @UseGuards(JwtAuthGuard)
  listAdmin(@Query() query: { categoryIds?: string; search?: string; limit?: string }) {
    return this.list(query);
  }

  @Post('admin/products')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateProductDto) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await uniqueProductSlug(this.prisma, dto.name);
      try {
        const row = await this.prisma.product.create({
          data: { ...productData(dto), slug } as any,
          include: { category: true },
        });
        return productJson(row);
      } catch (error) {
        const slugConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          String(error.meta?.target ?? '').includes('slug');
        if (!slugConflict) throw error;
      }
    }
    throw new ConflictException('Could not reserve a unique product URL; please try again');
  }

  @Patch('admin/products/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { images: true, imageViews: true },
    });
    if (!existing) throw new NotFoundException('Product not found');
    const row = await this.prisma.product.update({ where: { id }, data: productData(dto), include: { category: true } });
    await this.media.removeUnreferencedUrls(productMediaUrls(existing));
    return productJson(row);
  }

  @Delete('admin/products/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { images: true, imageViews: true },
    });
    if (!existing) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id } });
    await this.media.removeUnreferencedUrls(productMediaUrls(existing));
    return { success: true };
  }
}
