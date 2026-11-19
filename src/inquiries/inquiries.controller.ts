import {
  BadRequestException,
  Body,
  ConflictException,
  NotFoundException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { inquiryJson } from '../common/serializers';
import { PrismaService } from '../database/prisma.service';
import { adminActor } from '../promo/promo.controller';
import { CancelInquiryDto, ConfirmSaleDto } from '../promo/promo.dto';
import { PromoService } from '../promo/promo.service';
import { CreateAdminInquiryDto, CreateFeedbackDto, CreateInquiryDto, UpdateInquiryStatusDto } from './inquiries.dto';
import { TelegramNotificationsService } from './telegram-notifications.service';

const adminInclude = {
  promoCode: { select: { code: true, marketer: { select: { id: true, name: true } } } },
  commission: true,
  disputes: { where: { status: 'open' as const }, select: { id: true } },
};

@Controller()
export class InquiriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramNotifications: TelegramNotificationsService,
    private readonly promo: PromoService,
  ) {}

  private async createInquiry(
    dto: CreateInquiryDto | CreateAdminInquiryDto,
    source: 'website' | 'admin',
    actor: string,
  ) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: dto.product_id },
      select: { id: true, name: true, sizes: true, colorName: true, price: true, currency: true },
    });
    const selectedSize = dto.selected_size?.trim() || null;
    if (product.sizes.length > 0 && (!selectedSize || !product.sizes.includes(selectedSize))) {
      throw new BadRequestException('Please select an available product size');
    }
    if (product.sizes.length === 0 && selectedSize) {
      throw new BadRequestException('This product does not have selectable sizes');
    }
    const row = await this.prisma.$transaction(async (transaction) => {
      const promo = await this.promo.attributionForNewInquiry(
        transaction,
        product,
        dto.phone,
        dto.promo_code,
      );
      const inquiry = await transaction.inquiry.create({
        data: {
          productId: product.id,
          productName: product.name,
          fullName: dto.full_name.trim(),
          phone: dto.phone.trim(),
          telegram: dto.telegram?.trim() || '',
          selectedSize,
          selectedColor: product.colorName,
          message: dto.message?.trim() || null,
          source,
          quantity: 'quantity' in dto && dto.quantity ? dto.quantity : 1,
          customerLinkCode: this.promo.newCustomerLinkCode(),
          ...promo,
        },
      });
      await this.promo.afterInquiryCreated(transaction, inquiry.id, actor);

      if (source === 'website' && this.telegramNotifications.isEnabled()) {
        await transaction.inquiryNotification.create({ data: { inquiryId: inquiry.id } });
      }

      return inquiry;
    });

    this.telegramNotifications.wake();
    return row;
  }

  @Post('inquiries')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() dto: CreateInquiryDto) {
    const row = await this.createInquiry(dto, 'website', 'customer');
    return {
      ...inquiryJson(row),
      telegram_updates_url: this.promo.customerTelegramUrl(row.customerLinkCode),
    };
  }

  /**
   * Optional rating right after an inquiry. The inquiry id is only known to the
   * person who submitted it (returned by POST /inquiries), one answer per inquiry.
   */
  @Post('inquiries/:id/feedback')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateFeedbackDto) {
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id },
      select: { id: true, createdAt: true, feedback: { select: { id: true } } },
    });
    if (!inquiry || inquiry.createdAt.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
      throw new NotFoundException('Inquiry not found');
    }
    if (inquiry.feedback) throw new ConflictException('Thank you — feedback was already received');
    const row = await this.prisma.inquiryFeedback.create({
      data: {
        inquiryId: id,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
        allowPublic: dto.allow_public ?? false,
      },
    });
    return { id: row.id, rating: row.rating };
  }

  @Get('admin/feedback')
  @UseGuards(JwtAuthGuard)
  async listFeedback() {
    const rows = await this.prisma.inquiryFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        inquiry: {
          select: { id: true, productId: true, productName: true, fullName: true, phone: true, status: true },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      allow_public: row.allowPublic,
      created_at: row.createdAt,
      inquiry: {
        id: row.inquiry.id,
        product_id: row.inquiry.productId,
        product_name: row.inquiry.productName,
        customer: row.inquiry.fullName,
        phone: row.inquiry.phone,
        status: row.inquiry.status,
      },
    }));
  }

  @Get('admin/inquiries')
  @UseGuards(JwtAuthGuard)
  async list() {
    const rows = await this.prisma.inquiry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: adminInclude,
    });
    return rows.map(inquiryJson);
  }

  @Post('admin/inquiries')
  @UseGuards(JwtAuthGuard)
  async createManual(@Body() dto: CreateAdminInquiryDto, @Req() req: any) {
    const row = await this.createInquiry(dto, 'admin', adminActor(req));
    return this.reload(row.id);
  }

  private async reload(id: string) {
    return inquiryJson(
      await this.prisma.inquiry.findUniqueOrThrow({ where: { id }, include: adminInclude }),
    );
  }

  @Patch('admin/inquiries/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInquiryStatusDto,
    @Req() req: any,
  ) {
    if (dto.status === 'contacted') await this.promo.markContacted(id, adminActor(req));
    else await this.promo.markNew(id, adminActor(req));
    return this.reload(id);
  }

  @Post('admin/inquiries/:id/confirm')
  @UseGuards(JwtAuthGuard)
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmSaleDto, @Req() req: any) {
    await this.promo.confirmSale(id, dto, adminActor(req));
    return this.reload(id);
  }

  @Post('admin/inquiries/:id/deliver')
  @UseGuards(JwtAuthGuard)
  async deliver(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.promo.markDelivered(id, adminActor(req));
    return this.reload(id);
  }

  @Post('admin/inquiries/:id/cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInquiryDto, @Req() req: any) {
    await this.promo.cancel(id, dto, adminActor(req));
    return this.reload(id);
  }

  @Post('admin/inquiries/:id/reopen')
  @UseGuards(JwtAuthGuard)
  async reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    await this.promo.reopen(id, adminActor(req));
    return this.reload(id);
  }

  @Get('admin/inquiries/:id/history')
  @UseGuards(JwtAuthGuard)
  async history(@Param('id', ParseUUIDPipe) id: string) {
    const events = await this.prisma.auditEvent.findMany({
      where: { entity: 'inquiry', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actor,
      detail: e.detail,
      created_at: e.createdAt,
    }));
  }
}
