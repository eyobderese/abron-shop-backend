import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { adJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { MediaService } from '../media/media.service';
import { CreateAdvertisementDto, UpdateAdvertisementDto } from './advertisements.dto';

function adData(dto: CreateAdvertisementDto | UpdateAdvertisementDto) {
  return {
    ...(dto.title !== undefined && { title: dto.title }),
    ...(dto.media_url !== undefined && { mediaUrl: dto.media_url }),
    ...(dto.media_type !== undefined && { mediaType: dto.media_type }),
    ...(dto.poster_url !== undefined && { posterUrl: dto.poster_url || null }),
    ...(dto.link_url !== undefined && { linkUrl: dto.link_url || null }),
    ...(dto.placement !== undefined && { placement: dto.placement }),
    ...(dto.category_id !== undefined && { categoryId: dto.category_id || null }),
    ...(dto.sort_order !== undefined && { sortOrder: dto.sort_order }),
    ...(dto.is_active !== undefined && { isActive: dto.is_active }),
    ...(dto.starts_at !== undefined && { startsAt: dto.starts_at ? new Date(dto.starts_at) : null }),
    ...(dto.ends_at !== undefined && { endsAt: dto.ends_at ? new Date(dto.ends_at) : null }),
  };
}

function validateWindow(dto: CreateAdvertisementDto | UpdateAdvertisementDto) {
  if (dto.placement === 'category_top' && !dto.category_id) {
    throw new BadRequestException('category_id is required for category_top advertisements');
  }
  if (dto.starts_at && dto.ends_at && new Date(dto.ends_at) <= new Date(dto.starts_at)) {
    throw new BadRequestException('ends_at must be after starts_at');
  }
}

@Controller()
export class AdvertisementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  @Get('advertisements')
  async listPublic(@Query('placement') placement?: string, @Query('categoryId') categoryId?: string) {
    const now = new Date();
    const where: Prisma.AdvertisementWhereInput = {
      isActive: true,
      ...(placement && { placement: placement as any }),
      ...(placement === 'category_top' && categoryId && { categoryId }),
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    };
    const rows = await this.prisma.advertisement.findMany({ where, orderBy: { sortOrder: 'asc' } });
    return rows.map(adJson);
  }

  @Get('admin/advertisements')
  @UseGuards(JwtAuthGuard)
  async listAdmin() {
    const rows = await this.prisma.advertisement.findMany({
      orderBy: [{ placement: 'asc' }, { sortOrder: 'asc' }],
    });
    return rows.map(adJson);
  }

  @Post('admin/advertisements')
  @UseGuards(JwtAuthGuard)
  async create(@Body() dto: CreateAdvertisementDto) {
    validateWindow(dto);
    const row = await this.prisma.advertisement.create({ data: adData(dto) as any });
    return adJson(row);
  }

  @Patch('admin/advertisements/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateAdvertisementDto) {
    validateWindow(dto);
    const existing = await this.prisma.advertisement.findUnique({
      where: { id },
      select: { mediaUrl: true, posterUrl: true },
    });
    if (!existing) throw new NotFoundException('Advertisement not found');
    const row = await this.prisma.advertisement.update({ where: { id }, data: adData(dto) });
    await this.media.removeUnreferencedUrls([existing.mediaUrl, existing.posterUrl]);
    return adJson(row);
  }

  @Delete('admin/advertisements/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.advertisement.findUnique({
      where: { id },
      select: { mediaUrl: true, posterUrl: true },
    });
    if (!existing) throw new NotFoundException('Advertisement not found');
    await this.prisma.advertisement.delete({ where: { id } });
    await this.media.removeUnreferencedUrls([existing.mediaUrl, existing.posterUrl]);
    return { success: true };
  }
}
