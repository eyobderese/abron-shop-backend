import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { inquiryJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { CreateInquiryDto, UpdateInquiryStatusDto } from './inquiries.dto';

@Controller()
export class InquiriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('inquiries')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() dto: CreateInquiryDto) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: dto.product_id },
      select: { id: true, name: true, sizes: true, colorName: true },
    });
    const selectedSize = dto.selected_size?.trim() || null;
    if (product.sizes.length > 0 && (!selectedSize || !product.sizes.includes(selectedSize))) {
      throw new BadRequestException('Please select an available product size');
    }
    if (product.sizes.length === 0 && selectedSize) {
      throw new BadRequestException('This product does not have selectable sizes');
    }
    const row = await this.prisma.inquiry.create({
      data: {
        productId: product.id,
        productName: product.name,
        fullName: dto.full_name.trim(),
        phone: dto.phone.trim(),
        telegram: dto.telegram.trim(),
        selectedSize,
        selectedColor: product.colorName,
        message: dto.message?.trim() || null,
      },
    });
    return inquiryJson(row);
  }

  @Get('admin/inquiries')
  @UseGuards(JwtAuthGuard)
  async list() {
    const rows = await this.prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map(inquiryJson);
  }

  @Patch('admin/inquiries/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateInquiryStatusDto) {
    const row = await this.prisma.inquiry.update({ where: { id }, data: { status: dto.status } });
    return inquiryJson(row);
  }
}
