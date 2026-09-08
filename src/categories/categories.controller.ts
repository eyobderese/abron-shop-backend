import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { categoryJson } from '../common/serializers';
import { MediaService } from '../media/media.service';
import { CreateCategoryDto, UpdateCategoryDto } from './categories.dto';

function categoryData(dto: CreateCategoryDto | UpdateCategoryDto) {
  return {
    ...(dto.parent_id !== undefined && { parentId: dto.parent_id || null }),
    ...(dto.slug !== undefined && { slug: dto.slug }),
    ...(dto.name_en !== undefined && { nameEn: dto.name_en }),
    ...(dto.name_am !== undefined && { nameAm: dto.name_am || null }),
    ...(dto.name_or !== undefined && { nameOr: dto.name_or || null }),
    ...(dto.image_url !== undefined && { imageUrl: dto.image_url || null }),
    ...(dto.sort_order !== undefined && { sortOrder: dto.sort_order }),
    ...(dto.is_active !== undefined && { isActive: dto.is_active }),
  };
}

@Controller()
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Get('categories')
  async listPublic() {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map(categoryJson);
  }

  @Get('admin/categories')
  @UseGuards(JwtAuthGuard)
  async listAdmin() {
    const rows = await this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] });
    return rows.map(categoryJson);
  }

  @Post('admin/categories')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateCategoryDto) {
    const row = await this.prisma.category.create({ data: categoryData(dto) as any });
    return categoryJson(row);
  }

  @Patch('admin/categories/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: { imageUrl: true },
    });
    if (!existing) throw new NotFoundException('Category not found');
    if (dto.parent_id === id) throw new BadRequestException('A category cannot be its own parent');
    if (dto.parent_id) {
      let current: string | null = dto.parent_id;
      while (current) {
        if (current === id) throw new BadRequestException('A category cannot be moved under its descendant');
        const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
          where: { id: current }, select: { parentId: true },
        });
        current = parent?.parentId ?? null;
      }
    }
    const row = await this.prisma.category.update({ where: { id }, data: categoryData(dto) });
    await this.media.removeUnreferencedUrls([existing.imageUrl]);
    return categoryJson(row);
  }

  @Delete('admin/categories/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    const categories = await this.prisma.category.findMany({
      select: { id: true, parentId: true, imageUrl: true },
    });
    if (!categories.some((category) => category.id === id)) {
      throw new NotFoundException('Category not found');
    }
    const descendantIds = new Set([id]);
    let previousSize = 0;
    while (descendantIds.size !== previousSize) {
      previousSize = descendantIds.size;
      for (const category of categories) {
        if (category.parentId && descendantIds.has(category.parentId)) {
          descendantIds.add(category.id);
        }
      }
    }
    const mediaUrls = categories
      .filter((category) => descendantIds.has(category.id))
      .map((category) => category.imageUrl);
    await this.prisma.category.delete({ where: { id } });
    await this.media.removeUnreferencedUrls(mediaUrls);
    return { success: true };
  }
}
