import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma, ProductSizeType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { productJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { MediaService } from '../media/media.service';
import { CreateProductDto, UpdateProductDto } from './products.dto';
import { uniqueProductSlug } from './product-slug';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR_WORDS = new Set([
  'beige', 'black', 'blue', 'brown', 'cream', 'gold', 'gray', 'green',
  'grey', 'maroon', 'multicolor', 'navy', 'orange', 'pink', 'purple',
  'red', 'silver', 'tan', 'white', 'yellow',
]);

function normalizedText(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? '';
}

function familyKey(brand: string, modelCode: string) {
  return `${normalizedText(brand)}::${normalizedText(modelCode)}`;
}

function variantKey(colorName: string, colorCode?: string | null) {
  return normalizedText(colorCode) || normalizedText(colorName);
}

function recommendationTokens(name: string, brand?: string | null) {
  const brandTokens = new Set(normalizedText(brand).match(/[\p{L}\p{N}]+/gu) ?? []);
  return [
    ...new Set(
      (normalizedText(name).match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (token) => token.length > 1 && !COLOR_WORDS.has(token) && !brandTokens.has(token),
      ),
    ),
  ];
}

function nameSimilarity(sourceTokens: string[], candidateName: string, candidateBrand?: string | null) {
  const candidateTokens = recommendationTokens(candidateName, candidateBrand);
  if (sourceTokens.length === 0 || candidateTokens.length === 0) return 0;
  const candidateSet = new Set(candidateTokens);
  const matches = sourceTokens.filter((token) => candidateSet.has(token)).length;
  return (2 * matches) / (sourceTokens.length + candidateTokens.length);
}

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

function normalizedSizes(sizes: string[] = []) {
  return [...new Set(sizes.map((size) => size.trim()).filter(Boolean))];
}

function validateSizeConfiguration(sizeType: ProductSizeType, sizes: string[]) {
  if (sizeType === ProductSizeType.NONE && sizes.length > 0) {
    throw new BadRequestException('Products without a size type cannot have sizes');
  }
  if (sizeType !== ProductSizeType.NONE && sizes.length === 0) {
    throw new BadRequestException('Select at least one available product size');
  }
}

function productData(dto: CreateProductDto | UpdateProductDto) {
  return {
    ...(dto.name !== undefined && { name: dto.name.trim() }),
    ...(dto.product_type !== undefined && { productType: dto.product_type.trim() }),
    ...(dto.name_am !== undefined && { nameAm: dto.name_am || null }),
    ...(dto.name_or !== undefined && { nameOr: dto.name_or || null }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.description_am !== undefined && { descriptionAm: dto.description_am || null }),
    ...(dto.description_or !== undefined && { descriptionOr: dto.description_or || null }),
    ...(dto.category_id !== undefined && { categoryId: dto.category_id }),
    ...(dto.brand !== undefined && { brand: dto.brand?.trim() || null }),
    ...(dto.color_name !== undefined && { colorName: dto.color_name?.trim() || null }),
    ...(dto.color_code !== undefined && { colorCode: dto.color_code?.trim() || null }),
    ...(dto.color_hex !== undefined && { colorHex: dto.color_hex?.toUpperCase() || null }),
    ...(dto.variant_sort_order !== undefined && { variantSort: dto.variant_sort_order }),
    ...(dto.price !== undefined && { price: dto.price }),
    ...(dto.was_price !== undefined && { wasPrice: dto.was_price }),
    ...(dto.currency !== undefined && { currency: dto.currency }),
    ...(dto.size_type !== undefined && { sizeType: dto.size_type }),
    ...(dto.sizes !== undefined && { sizes: normalizedSizes(dto.sizes) }),
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

  private async resolveFamily(
    brand: string | null,
    modelCode: string | null,
    displayName: string,
  ) {
    if (!modelCode) return null;
    if (!brand) {
      throw new BadRequestException('Brand is required when a model code is provided');
    }
    const normalizedKey = familyKey(brand, modelCode);
    return this.prisma.productFamily.upsert({
      where: { key: normalizedKey },
      create: {
        key: normalizedKey,
        brand: brand.trim(),
        modelCode: modelCode.trim(),
        displayName: displayName.trim(),
      },
      update: {
        brand: brand.trim(),
        modelCode: modelCode.trim(),
        displayName: displayName.trim(),
      },
    });
  }

  private async list(query: { categoryIds?: string; search?: string; limit?: string }) {
    const categoryIds = query.categoryIds?.split(',').filter(Boolean) ?? [];
    const tokens = query.search?.trim().split(/\s+/).filter(Boolean).slice(0, 8) ?? [];
    const where: Prisma.ProductWhereInput = {
      ...(categoryIds.length && { categoryId: { in: categoryIds } }),
      ...(tokens.length && {
        AND: tokens.map((token) => ({
          OR: [
            ...[
              'name',
              'nameAm',
              'nameOr',
              'productType',
              'brand',
              'description',
              'descriptionAm',
              'descriptionOr',
            ].map((field) => ({
              [field]: { contains: token, mode: 'insensitive' },
            })),
            {
              family: {
                is: {
                  OR: [
                    { modelCode: { contains: token, mode: 'insensitive' } },
                    { displayName: { contains: token, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        })),
      }),
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: { category: true, family: true },
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
    const row = await this.prisma.product.findUnique({
      where,
      include: { category: true, family: true },
    });
    if (!row) throw new NotFoundException('Product not found');
    return productJson(row);
  }

  @Get('products/:identifier/variants')
  async variants(@Param('identifier') identifier: string) {
    const where = UUID_PATTERN.test(identifier)
      ? { id: identifier }
      : { slug: identifier.toLowerCase() };
    const source = await this.prisma.product.findUnique({
      where,
      select: { familyId: true },
    });
    if (!source) throw new NotFoundException('Product not found');
    if (!source.familyId) return [];

    const rows = await this.prisma.product.findMany({
      where: { familyId: source.familyId },
      include: { category: true, family: true },
      orderBy: [{ variantSort: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(productJson);
  }

  @Get('products/:identifier/related')
  async related(
    @Param('identifier') identifier: string,
    @Query('limit') requestedLimit?: string,
  ) {
    const where = UUID_PATTERN.test(identifier)
      ? { id: identifier }
      : { slug: identifier.toLowerCase() };
    const source = await this.prisma.product.findUnique({
      where,
      select: { id: true, name: true, brand: true, categoryId: true, familyId: true },
    });
    if (!source) throw new NotFoundException('Product not found');

    const limit = Math.min(Math.max(Number(requestedLimit) || 8, 1), 12);
    const sourceTokens = recommendationTokens(source.name, source.brand).slice(0, 8);
    const include = { category: true, family: true } as const;
    const searches: Promise<any[]>[] = [];
    const relatedBase: Prisma.ProductWhereInput = {
      id: { not: source.id },
      ...(source.familyId && {
        OR: [
          { familyId: null },
          { familyId: { not: source.familyId } },
        ],
      }),
    };

    if (source.brand) {
      searches.push(
        this.prisma.product.findMany({
          where: {
            ...relatedBase,
            brand: { equals: source.brand, mode: 'insensitive' },
          },
          include,
          orderBy: { createdAt: 'desc' },
          take: 120,
        }),
      );
    }
    if (sourceTokens.length > 0) {
      searches.push(
        this.prisma.product.findMany({
          where: {
            AND: [
              relatedBase,
              {
                OR: sourceTokens.map((token) => ({
                  name: { contains: token, mode: 'insensitive' },
                })),
              },
            ],
          },
          include,
          orderBy: { createdAt: 'desc' },
          take: 120,
        }),
      );
    }
    if (source.categoryId) {
      searches.push(
        this.prisma.product.findMany({
          where: { ...relatedBase, categoryId: source.categoryId },
          include,
          orderBy: { createdAt: 'desc' },
          take: 120,
        }),
      );
    }

    const candidates = new Map<string, any>();
    for (const rows of await Promise.all(searches)) {
      for (const row of rows) {
        if (row.id === source.id || (source.familyId && row.familyId === source.familyId)) {
          continue;
        }
        candidates.set(row.id, row);
      }
    }

    return [...candidates.values()]
      .map((candidate) => {
        const sameBrand =
          normalizedText(source.brand) !== '' &&
          normalizedText(source.brand) === normalizedText(candidate.brand);
        const sameCategory =
          source.categoryId !== null && source.categoryId === candidate.categoryId;
        const similarity = nameSimilarity(sourceTokens, candidate.name, candidate.brand);
        const score =
          (sameBrand ? 1_000 : 0) +
          similarity * 100 +
          (sameCategory ? 20 : 0) +
          (candidate.inStock ? 2 : 0);
        return { candidate, score };
      })
      .sort((left, right) =>
        right.score - left.score ||
        right.candidate.createdAt.getTime() - left.candidate.createdAt.getTime(),
      )
      .slice(0, limit)
      .map(({ candidate }) => productJson(candidate));
  }

  @Get('admin/products')
  @UseGuards(JwtAuthGuard)
  listAdmin(@Query() query: { categoryIds?: string; search?: string; limit?: string }) {
    return this.list(query);
  }

  @Post('admin/products')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateProductDto) {
    validateSizeConfiguration(
      dto.size_type ?? ProductSizeType.NONE,
      normalizedSizes(dto.sizes),
    );
    const brand = dto.brand?.trim() || null;
    if (!brand) {
      throw new BadRequestException('Brand is required');
    }
    const modelCode = dto.model_code?.trim() || null;
    if (modelCode && !dto.family_name?.trim()) {
      throw new BadRequestException('Model/family name is required with a model code');
    }
    const family = await this.resolveFamily(
      brand,
      modelCode,
      dto.family_name?.trim() || dto.name,
    );
    const colorName = dto.color_name?.trim() || null;
    const colorCode = dto.color_code?.trim() || null;
    if (family && !colorName) {
      throw new BadRequestException('Color name is required for a product variant');
    }
    const productVariantKey = family && colorName
      ? variantKey(colorName, colorCode)
      : null;
    const slugName = colorName && !normalizedText(dto.name).includes(normalizedText(colorName))
      ? `${dto.name} ${colorName}`
      : dto.name;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await uniqueProductSlug(this.prisma, slugName);
      try {
        const row = await this.prisma.product.create({
          data: {
            ...productData(dto),
            slug,
            familyId: family?.id ?? null,
            variantKey: productVariantKey,
          } as any,
          include: { category: true, family: true },
        });
        return productJson(row);
      } catch (error) {
        const uniqueTarget = String(
          error instanceof Prisma.PrismaClientKnownRequestError
            ? error.meta?.target ?? ''
            : '',
        );
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          uniqueTarget.includes('variant')
        ) {
          throw new ConflictException('This color already exists for the selected model');
        }
        const slugConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          uniqueTarget.includes('slug');
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
      select: {
        images: true,
        imageViews: true,
        sizeType: true,
        sizes: true,
        brand: true,
        family: true,
        colorName: true,
        colorCode: true,
      },
    });
    if (!existing) throw new NotFoundException('Product not found');
    validateSizeConfiguration(
      dto.size_type ?? existing.sizeType,
      dto.sizes === undefined ? existing.sizes : normalizedSizes(dto.sizes),
    );
    const brand = dto.brand === undefined
      ? existing.brand
      : dto.brand?.trim() || null;
    if (!brand) {
      throw new BadRequestException('Brand is required');
    }
    const modelCode = dto.model_code === undefined
      ? existing.family?.modelCode ?? null
      : dto.model_code?.trim() || null;
    const displayName = dto.family_name === undefined
      ? existing.family?.displayName ?? dto.name ?? 'Product model'
      : dto.family_name?.trim() || dto.name || existing.family?.displayName || 'Product model';
    const family = await this.resolveFamily(brand, modelCode, displayName);
    const colorName = dto.color_name === undefined
      ? existing.colorName
      : dto.color_name?.trim() || null;
    const colorCode = dto.color_code === undefined
      ? existing.colorCode
      : dto.color_code?.trim() || null;
    if (family && !colorName) {
      throw new BadRequestException('Color name is required for a product variant');
    }

    let row;
    try {
      row = await this.prisma.product.update({
        where: { id },
        data: {
          ...productData(dto),
          familyId: family?.id ?? null,
          variantKey: family && colorName ? variantKey(colorName, colorCode) : null,
        },
        include: { category: true, family: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String(error.meta?.target ?? '').includes('variant')
      ) {
        throw new ConflictException('This color already exists for the selected model');
      }
      throw error;
    }
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
