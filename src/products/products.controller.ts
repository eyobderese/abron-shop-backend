import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { productJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { CreateProductDto, UpdateProductDto } from './products.dto';

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
    ...(dto.images !== undefined && { images: dto.images }),
    ...(dto.image_views !== undefined && { imageViews: dto.image_views as any }),
    ...(dto.in_stock !== undefined && { inStock: dto.in_stock }),
  };
}

@Controller()
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get('products/:id')
  async getOne(@Param('id') id: string) {
    const row = await this.prisma.product.findUniqueOrThrow({ where: { id }, include: { category: true } });
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
    const row = await this.prisma.product.create({ data: productData(dto) as any, include: { category: true } });
    return productJson(row);
  }

  @Patch('admin/products/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const row = await this.prisma.product.update({ where: { id }, data: productData(dto), include: { category: true } });
    return productJson(row);
  }

  @Delete('admin/products/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }
}
