import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CancelReason, InquiryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  CancelInquiryDto,
  ConfirmSaleDto,
  CreateMarketerDto,
  CreatePayoutDto,
  CreatePromoCodeDto,
  OpenDisputeDto,
  ResolveDisputeDto,
  UpdateMarketerDto,
  UpdatePromoCodeDto,
} from './promo.dto';
import {
  formatAmount,
  maskName,
  maskPhone,
  money,
  normalizeCode,
  phoneKey,
  randomToken,
  round2,
  sha256,
} from './promo.util';
import { TelegramBotService, TelegramUpdate } from './telegram-bot.service';

type Db = Prisma.TransactionClient | PrismaService;

const DAY_MS = 24 * 60 * 60 * 1000;

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  no_answer: 'Customer did not answer',
  changed_mind: 'Customer changed their mind',
  price: 'Customer found the price too high',
  out_of_stock: 'Product not available',
  duplicate: 'Duplicate inquiry',
  returned: 'Returned after purchase',
  other: 'Other',
};

const inquiryInclude = {
  promoCode: { include: { marketer: true } },
  commission: true,
} satisfies Prisma.InquiryInclude;

type InquiryWithPromo = Prisma.InquiryGetPayload<{ include: typeof inquiryInclude }>;

type ProductForPricing = {
  id: string;
  name: string;
  price: Prisma.Decimal | null;
  currency: 'ETB' | 'USD';
};

@Injectable()
export class PromoService implements OnModuleInit {
  private readonly logger = new Logger(PromoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bot: TelegramBotService,
  ) {}

  onModuleInit() {
    this.bot.setUpdateHandler((update) => this.handleTelegramUpdate(update));
    this.bot.onTick(() => this.approveEligibleCommissions());
  }

  // ───────────────────────── settings ─────────────────────────

  private num(key: string, fallback: number) {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  terms() {
    return {
      attribution_days: this.num('PROMO_ATTRIBUTION_DAYS', 60),
      hold_days: this.num('PROMO_HOLD_DAYS', 7),
      dispute_multiplier: this.num('PROMO_DISPUTE_MULTIPLIER', 2),
      commission_currency: 'ETB',
    };
  }

  private siteUrl() {
    return (this.config.get<string>('PUBLIC_SITE_URL') || 'https://abronshop.online').replace(/\/$/, '');
  }

  portalUrl(rawToken: string) {
    return `${this.siteUrl()}/partner/${rawToken}`;
  }

  shareUrl(code: string) {
    return `${this.siteUrl()}/?ref=${encodeURIComponent(code)}`;
  }

  // ───────────────────────── audit ─────────────────────────

  private audit(
    db: Db,
    entity: string,
    entityId: string,
    action: string,
    actor: string,
    marketerId: string | null | undefined,
    detail: Record<string, unknown> = {},
  ) {
    return db.auditEvent.create({
      data: {
        entity,
        entityId,
        action,
        actor,
        marketerId: marketerId ?? null,
        detail: detail as Prisma.InputJsonValue,
      },
    });
  }

  // ───────────────────────── codes + pricing ─────────────────────────

  private async loadUsableCode(db: Db, rawCode: string) {
    const code = normalizeCode(rawCode);
    if (!code) throw new BadRequestException('Enter a promo code');
    const row = await db.promoCode.findUnique({ where: { code }, include: { marketer: true } });
    const now = new Date();
    if (!row || !row.isActive || !row.marketer.isActive) {
      throw new BadRequestException('This promo code is not valid');
    }
    if (row.startsAt && row.startsAt > now) throw new BadRequestException('This promo code is not active yet');
    if (row.endsAt && row.endsAt <= now) throw new BadRequestException('This promo code has expired');
    if (row.maxUses) {
      const used = await db.inquiry.count({
        where: { promoCodeId: row.id, attributionSource: 'code', status: { not: 'cancelled' } },
      });
      if (used >= row.maxUses) throw new BadRequestException('This promo code has reached its usage limit');
    }
    return row;
  }

  private pricing(
    code: { discountType: 'PERCENT' | 'FIXED'; discountValue: Prisma.Decimal } | null,
    product: ProductForPricing,
  ) {
    const listPrice = money(product.price);
    let discountAmount: number | null = null;
    if (code && listPrice !== null) {
      const value = money(code.discountValue) ?? 0;
      if (code.discountType === 'PERCENT') {
        discountAmount = round2((listPrice * Math.min(value, 100)) / 100);
      } else if (product.currency === 'ETB') {
        // Fixed discounts are in ETB; for USD-priced items the discount is applied in the quote.
        discountAmount = Math.min(value, listPrice);
      }
    }
    return {
      listPrice,
      discountAmount,
      quotedPrice: listPrice !== null && discountAmount !== null ? round2(listPrice - discountAmount) : null,
      currency: product.currency,
    };
  }

  private describeDiscount(code: { discountType: string; discountValue: Prisma.Decimal }) {
    const value = money(code.discountValue);
    return code.discountType === 'PERCENT' ? `${value}% off` : `${value} ETB off`;
  }

  async validate(rawCode: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, price: true, currency: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    try {
      const code = await this.loadUsableCode(this.prisma, rawCode);
      const price = this.pricing(code, product);
      return {
        valid: true,
        code: code.code,
        discount_type: code.discountType,
        discount_value: money(code.discountValue),
        discount_label: this.describeDiscount(code),
        list_price: price.listPrice,
        discount_amount: price.discountAmount,
        quoted_price: price.quotedPrice,
        currency: price.currency,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { valid: false, message: (error.getResponse() as { message: string }).message };
      }
      throw error;
    }
  }

  async recordVisit(rawCode: string) {
    const code = await this.prisma.promoCode.findUnique({
      where: { code: normalizeCode(rawCode) },
      select: { id: true, isActive: true },
    });
    if (code?.isActive) await this.prisma.promoVisit.create({ data: { promoCodeId: code.id } });
    return { ok: true };
  }

  /** Latest code-attributed inquiry from the same phone inside the attribution window. */
  private async findPhoneAttribution(db: Db, key: string | null, excludeInquiryId?: string) {
    if (!key) return null;
    const since = new Date(Date.now() - this.terms().attribution_days * DAY_MS);
    const previous = await db.inquiry.findFirst({
      where: {
        phoneKey: key,
        attributionSource: 'code',
        promoCodeId: { not: null },
        createdAt: { gte: since },
        ...(excludeInquiryId && { id: { not: excludeInquiryId } }),
      },
      orderBy: { createdAt: 'desc' },
      include: { promoCode: { include: { marketer: true } } },
    });
    if (!previous?.promoCode || previous.promoCode.marketer.phoneKey === key) return null;
    return {
      promoCodeId: previous.promoCode.id,
      promoCodeText: previous.promoCode.code,
      commissionPerItem: previous.commissionPerItem ?? previous.promoCode.commissionAmount,
    };
  }

  /**
   * Promo/attribution fields for a new inquiry. The discount is always recomputed here;
   * the browser's preview is never trusted.
   */
  async attributionForNewInquiry(db: Db, product: ProductForPricing, phone: string, rawCode?: string | null) {
    const key = phoneKey(phone);
    const base = { phoneKey: key };

    if (rawCode && normalizeCode(rawCode)) {
      const code = await this.loadUsableCode(db, rawCode);
      if (code.marketer.phoneKey && code.marketer.phoneKey === key) {
        throw new BadRequestException("This promo code can't be used with the code owner's phone number");
      }
      const price = this.pricing(code, product);
      return {
        ...base,
        promoCodeId: code.id,
        promoCodeText: code.code,
        attributionSource: 'code' as const,
        commissionPerItem: code.commissionAmount,
        ...price,
      };
    }

    const viaPhone = await this.findPhoneAttribution(db, key);
    return {
      ...base,
      ...(viaPhone && { ...viaPhone, attributionSource: 'phone' as const }),
      ...this.pricing(null, product),
    };
  }

  /** Called inside the inquiry-create transaction. */
  async afterInquiryCreated(db: Db, inquiryId: string, actor: string) {
    const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId }, include: inquiryInclude });
    const marketer = inquiry.promoCode?.marketer;
    await this.audit(db, 'inquiry', inquiry.id, 'created', actor, marketer?.id, {
      product: inquiry.productName,
      code: inquiry.promoCodeText,
      attribution: inquiry.attributionSource,
      quoted_price: money(inquiry.quotedPrice),
      currency: inquiry.currency,
    });
    if (marketer) {
      const how = inquiry.attributionSource === 'phone'
        ? `returning customer (first came with ${inquiry.promoCodeText})`
        : `code ${inquiry.promoCodeText}`;
      await this.bot.enqueue(db, marketer.telegramChatId, [
        `🛍 New inquiry via ${how}`,
        `Product: ${inquiry.productName}`,
        `Customer: ${maskName(inquiry.fullName)} ${maskPhone(inquiry.phone)}`,
        inquiry.quotedPrice ? `Quoted price: ${formatAmount(inquiry.quotedPrice, inquiry.currency ?? 'ETB')}` : '',
        '',
        'We will contact the customer. You will get an update when it is sold or cancelled.',
      ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n'));
    }
  }

  customerTelegramUrl(customerLinkCode: string | null) {
    return customerLinkCode ? this.bot.deepLink(`i_${customerLinkCode}`) : null;
  }

  newCustomerLinkCode() {
    return randomToken(12);
  }

  // ───────────────────────── inquiry outcomes ─────────────────────────

  private async loadInquiry(db: Db, id: string) {
    const inquiry = await db.inquiry.findUnique({ where: { id }, include: inquiryInclude });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  private assertStatus(inquiry: { status: InquiryStatus }, allowed: InquiryStatus[], action: string) {
    if (!allowed.includes(inquiry.status)) {
      throw new BadRequestException(`Cannot ${action} an inquiry that is ${inquiry.status}`);
    }
  }

  private async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    const result = await this.prisma.$transaction(work);
    this.bot.wake();
    return result;
  }

  async markContacted(id: string, actor: string) {
    return this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['new', 'contacted', 'closed'], 'mark as contacted');
      if (inquiry.status === 'contacted') return inquiry;
      await tx.inquiry.update({ where: { id }, data: { status: 'contacted' } });
      await this.audit(tx, 'inquiry', id, 'contacted', actor, inquiry.promoCode?.marketerId);
      return this.loadInquiry(tx, id);
    });
  }

  async markNew(id: string, actor: string) {
    return this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['new', 'contacted'], 'mark as new');
      if (inquiry.status === 'new') return inquiry;
      await tx.inquiry.update({ where: { id }, data: { status: 'new' } });
      await this.audit(tx, 'inquiry', id, 'marked_new', actor, inquiry.promoCode?.marketerId);
      return this.loadInquiry(tx, id);
    });
  }

  async confirmSale(id: string, dto: ConfirmSaleDto, actor: string) {
    return this.run(async (tx) => {
      let inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['new', 'contacted', 'closed', 'confirmed'], 'confirm');
      const editing = inquiry.status === 'confirmed';
      const quantity = dto.quantity ?? inquiry.quantity;

      // Phone-based attribution is re-checked at sale time, so a sale can't be detached
      // from the marketer who brought the customer.
      if (!inquiry.promoCodeId) {
        const viaPhone = await this.findPhoneAttribution(tx, inquiry.phoneKey ?? phoneKey(inquiry.phone), id);
        if (viaPhone) {
          await tx.inquiry.update({ where: { id }, data: { ...viaPhone, attributionSource: 'phone' } });
          inquiry = await this.loadInquiry(tx, id);
          await this.audit(tx, 'inquiry', id, 'attributed_by_phone', 'system', inquiry.promoCode?.marketerId, {
            code: viaPhone.promoCodeText,
          });
        }
      }

      await tx.inquiry.update({
        where: { id },
        data: {
          status: 'confirmed',
          finalAmount: dto.final_amount,
          quantity,
          confirmedAt: inquiry.confirmedAt ?? new Date(),
          cancelReason: null,
          cancelNote: null,
          cancelledAt: null,
        },
      });
      const marketerId = inquiry.promoCode?.marketerId;
      await this.audit(tx, 'inquiry', id, editing ? 'sale_amount_changed' : 'confirmed', actor, marketerId, {
        ...(editing && { previous_amount: money(inquiry.finalAmount), previous_quantity: inquiry.quantity }),
        final_amount: dto.final_amount,
        quantity,
        currency: inquiry.currency,
      });

      let commissionAmount: Prisma.Decimal | null = null;
      if (marketerId && inquiry.commissionPerItem) {
        commissionAmount = new Prisma.Decimal(inquiry.commissionPerItem).mul(quantity);
        const existing = inquiry.commission;
        if (!existing) {
          const created = await tx.commission.create({
            data: { marketerId, inquiryId: id, amount: commissionAmount, baseAmount: commissionAmount },
          });
          await this.audit(tx, 'commission', created.id, 'created', 'system', marketerId, {
            amount: money(commissionAmount),
            inquiry_id: id,
          });
        } else if (!existing.isPenalty && (existing.status === 'pending' || existing.status === 'void')) {
          await tx.commission.update({
            where: { id: existing.id },
            data: {
              amount: commissionAmount,
              baseAmount: commissionAmount,
              status: 'pending',
              voidReason: null,
              eligibleAt: null,
            },
          });
          await this.audit(tx, 'commission', existing.id, existing.status === 'void' ? 'restored' : 'updated', 'system', marketerId, {
            previous_amount: money(existing.amount),
            amount: money(commissionAmount),
          });
        }
      }

      const marketer = inquiry.promoCode?.marketer;
      if (marketer) {
        await this.bot.enqueue(tx, marketer.telegramChatId, [
          editing ? '✏️ Sale updated' : '✅ Sale confirmed',
          `Product: ${inquiry.productName} × ${quantity}`,
          `Customer: ${maskName(inquiry.fullName)} ${maskPhone(inquiry.phone)}`,
          `Sale amount: ${formatAmount(dto.final_amount, inquiry.currency ?? 'ETB')}`,
          commissionAmount ? `Your commission: ${formatAmount(commissionAmount)} (pending until ${this.terms().hold_days} days after delivery)` : '',
        ].filter(Boolean).join('\n'));
      }
      if (!editing) {
        await this.bot.enqueue(tx, inquiry.customerChatId, [
          '✅ Abron Shop: your order is confirmed',
          `Product: ${inquiry.productName} × ${quantity}`,
          `Amount: ${formatAmount(dto.final_amount, inquiry.currency ?? 'ETB')}`,
          'Thank you for shopping with us!',
        ].join('\n'));
      }
      return this.loadInquiry(tx, id);
    });
  }

  async markDelivered(id: string, actor: string) {
    return this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['confirmed'], 'mark as delivered');
      const now = new Date();
      await tx.inquiry.update({ where: { id }, data: { status: 'delivered', deliveredAt: now } });
      const marketerId = inquiry.promoCode?.marketerId;
      await this.audit(tx, 'inquiry', id, 'delivered', actor, marketerId);
      const commission = inquiry.commission;
      const eligibleAt = new Date(now.getTime() + this.terms().hold_days * DAY_MS);
      if (commission?.status === 'pending') {
        await tx.commission.update({ where: { id: commission.id }, data: { eligibleAt } });
      }
      if (inquiry.promoCode?.marketer) {
        await this.bot.enqueue(tx, inquiry.promoCode.marketer.telegramChatId, [
          '📦 Delivered',
          `Product: ${inquiry.productName}`,
          commission?.status === 'pending'
            ? `Your commission of ${formatAmount(commission.amount)} becomes payable on ${eligibleAt.toISOString().slice(0, 10)}.`
            : '',
        ].filter(Boolean).join('\n'));
      }
      return this.loadInquiry(tx, id);
    });
  }

  async cancel(id: string, dto: CancelInquiryDto, actor: string) {
    if (dto.reason === 'other' && !dto.note?.trim()) {
      throw new BadRequestException('Please describe the reason');
    }
    return this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['new', 'contacted', 'confirmed', 'delivered', 'closed'], 'cancel');
      const commission = inquiry.commission;
      if (commission?.status === 'paid') {
        throw new BadRequestException('The commission for this sale was already paid; it cannot be cancelled');
      }
      const note = dto.note?.trim() || null;
      await tx.inquiry.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelReason: dto.reason,
          cancelNote: note,
          cancelledAt: new Date(),
          customerConfirmation: null,
          customerConfirmedAt: null,
        },
      });
      const marketerId = inquiry.promoCode?.marketerId;
      await this.audit(tx, 'inquiry', id, 'cancelled', actor, marketerId, {
        reason: dto.reason,
        note,
        previous_status: inquiry.status,
      });
      if (commission && commission.status !== 'void') {
        await tx.commission.update({
          where: { id: commission.id },
          data: { status: 'void', voidReason: CANCEL_REASON_LABELS[dto.reason] },
        });
        await this.audit(tx, 'commission', commission.id, 'voided', actor, marketerId, {
          reason: dto.reason,
          amount: money(commission.amount),
        });
      }

      const asked = Boolean(inquiry.customerChatId);
      await this.bot.enqueue(
        tx,
        inquiry.customerChatId,
        [
          'Abron Shop: we closed your request as NOT purchased.',
          `Product: ${inquiry.productName}`,
          `Reason: ${CANCEL_REASON_LABELS[dto.reason]}`,
          '',
          'Is this correct?',
        ].join('\n'),
        {
          inline_keyboard: [[
            { text: "✅ Yes, I didn't buy", callback_data: `cc:${id}:y` },
            { text: '❌ No, I bought it', callback_data: `cc:${id}:n` },
          ]],
        },
      );
      if (inquiry.promoCode?.marketer) {
        await this.bot.enqueue(tx, inquiry.promoCode.marketer.telegramChatId, [
          '❌ Inquiry cancelled',
          `Product: ${inquiry.productName}`,
          `Customer: ${maskName(inquiry.fullName)} ${maskPhone(inquiry.phone)}`,
          `Reason: ${CANCEL_REASON_LABELS[dto.reason]}${note ? ` — ${note}` : ''}`,
          asked ? 'The customer has been asked on Telegram to confirm this.' : '',
          `If you believe it was sold, open a dispute from your partner page.`,
        ].filter(Boolean).join('\n'));
      }
      return this.loadInquiry(tx, id);
    });
  }

  async reopen(id: string, actor: string) {
    return this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, id);
      this.assertStatus(inquiry, ['cancelled'], 'reopen');
      await tx.inquiry.update({
        where: { id },
        data: {
          status: 'contacted',
          cancelReason: null,
          cancelNote: null,
          cancelledAt: null,
          customerConfirmation: null,
          customerConfirmedAt: null,
        },
      });
      await this.audit(tx, 'inquiry', id, 'reopened', actor, inquiry.promoCode?.marketerId, {
        previous_reason: inquiry.cancelReason,
      });
      if (inquiry.promoCode?.marketer) {
        await this.bot.enqueue(tx, inquiry.promoCode.marketer.telegramChatId,
          `🔄 Inquiry reopened: ${inquiry.productName} (${maskName(inquiry.fullName)}). Your credit stays attached.`);
      }
      return this.loadInquiry(tx, id);
    });
  }

  async approveEligibleCommissions() {
    const due = await this.prisma.commission.findMany({
      where: { status: 'pending', eligibleAt: { lte: new Date() } },
      include: { marketer: true, inquiry: { select: { productName: true, status: true } } },
      take: 200,
    });
    for (const commission of due) {
      if (commission.inquiry.status !== 'delivered') continue;
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.commission.updateMany({
          where: { id: commission.id, status: 'pending' },
          data: { status: 'approved' },
        });
        if (updated.count !== 1) return;
        await this.audit(tx, 'commission', commission.id, 'approved', 'system', commission.marketerId, {
          amount: money(commission.amount),
        });
        await this.bot.enqueue(tx, commission.marketer.telegramChatId,
          `💰 Commission approved: ${formatAmount(commission.amount)} for ${commission.inquiry.productName}. It will be included in your next payout.`);
      });
    }
    if (due.length) this.bot.wake();
  }

  // ───────────────────────── disputes ─────────────────────────

  private async createDispute(
    db: Db,
    inquiry: InquiryWithPromo,
    source: 'marketer' | 'customer',
    note: string | null,
  ) {
    const marketer = inquiry.promoCode?.marketer;
    if (!marketer) throw new BadRequestException('This inquiry is not linked to a marketer');
    const existing = await db.dispute.findFirst({
      where: { inquiryId: inquiry.id, status: { in: ['open', 'accepted'] } },
    });
    if (existing) return existing;
    const dispute = await db.dispute.create({
      data: { inquiryId: inquiry.id, marketerId: marketer.id, source, note },
    });
    await this.audit(db, 'dispute', dispute.id, 'opened', source, marketer.id, {
      inquiry_id: inquiry.id,
      source,
      note,
    });
    await this.bot.enqueue(db, this.bot.adminChatId(), [
      `⚠️ Dispute opened by ${source === 'customer' ? 'the customer' : `marketer ${marketer.name}`}`,
      `Product: ${inquiry.productName}`,
      `Customer: ${inquiry.fullName} ${inquiry.phone}`,
      `Code: ${inquiry.promoCodeText}`,
      note ? `Note: ${note}` : '',
      'Resolve it in Admin → Marketers → Disputes.',
    ].filter(Boolean).join('\n'));
    if (source === 'customer') {
      await this.bot.enqueue(db, marketer.telegramChatId,
        `⚠️ The customer for ${inquiry.productName} says they DID buy it. A dispute has been opened and the shop must respond.`);
    }
    return dispute;
  }

  async resolveDispute(id: string, dto: ResolveDisputeDto, actor: string) {
    return this.run(async (tx) => {
      const dispute = await tx.dispute.findUnique({ where: { id }, include: { marketer: true } });
      if (!dispute) throw new NotFoundException('Dispute not found');
      if (dispute.status !== 'open') throw new BadRequestException('This dispute is already resolved');
      const inquiry = await this.loadInquiry(tx, dispute.inquiryId);
      const response = dto.admin_response.trim();

      if (dto.decision === 'reject') {
        await tx.dispute.update({
          where: { id },
          data: { status: 'rejected', adminResponse: response, resolvedAt: new Date() },
        });
        await this.audit(tx, 'dispute', id, 'rejected', actor, dispute.marketerId, { response });
        await this.bot.enqueue(tx, dispute.marketer.telegramChatId, [
          `Dispute answered for ${inquiry.productName}: not accepted.`,
          `Shop response: ${response}`,
        ].join('\n'));
        return tx.dispute.findUniqueOrThrow({ where: { id } });
      }

      // Accepted: the sale happened. Record it and pay commission × multiplier.
      if (!inquiry.commissionPerItem) {
        throw new BadRequestException('This inquiry has no commission rate recorded');
      }
      if (inquiry.commission?.status === 'paid') {
        throw new BadRequestException('A commission for this inquiry was already paid');
      }
      const multiplier = this.terms().dispute_multiplier;
      const base = new Prisma.Decimal(inquiry.commissionPerItem).mul(inquiry.quantity);
      const amount = base.mul(multiplier);
      const now = new Date();
      await tx.inquiry.update({
        where: { id: inquiry.id },
        data: {
          status: inquiry.status === 'delivered' ? 'delivered' : 'confirmed',
          finalAmount: dto.final_amount ?? inquiry.finalAmount ?? inquiry.quotedPrice ?? inquiry.listPrice,
          confirmedAt: inquiry.confirmedAt ?? now,
          cancelReason: null,
          cancelNote: null,
          cancelledAt: null,
        },
      });
      const commissionData = {
        amount,
        baseAmount: base,
        isPenalty: true,
        status: 'approved' as const,
        eligibleAt: now,
        voidReason: null,
      };
      const commission = inquiry.commission
        ? await tx.commission.update({ where: { id: inquiry.commission.id }, data: commissionData })
        : await tx.commission.create({
            data: { ...commissionData, marketerId: dispute.marketerId, inquiryId: inquiry.id },
          });
      await tx.dispute.update({
        where: { id },
        data: { status: 'accepted', adminResponse: response, resolvedAt: now },
      });
      await this.audit(tx, 'dispute', id, 'accepted', actor, dispute.marketerId, { response });
      await this.audit(tx, 'commission', commission.id, 'penalty_applied', actor, dispute.marketerId, {
        base_amount: money(base),
        multiplier,
        amount: money(amount),
      });
      await this.audit(tx, 'inquiry', inquiry.id, 'confirmed_by_dispute', actor, dispute.marketerId);
      await this.bot.enqueue(tx, dispute.marketer.telegramChatId, [
        `✅ Dispute accepted for ${inquiry.productName}.`,
        `You will be paid ${formatAmount(amount)} (${formatAmount(base)} × ${multiplier}).`,
        `Shop response: ${response}`,
      ].join('\n'));
      return tx.dispute.findUniqueOrThrow({ where: { id } });
    });
  }

  // ───────────────────────── Telegram bot updates ─────────────────────────

  private async handleTelegramUpdate(update: TelegramUpdate) {
    const text = update.message?.text?.trim();
    if (update.message && text?.startsWith('/start')) {
      // Linking only happens in a private chat with the bot, never in a group
      // (otherwise a group could receive one marketer's or customer's messages).
      if (update.message.chat.type && update.message.chat.type !== 'private') return;
      const chatId = update.message.chat.id;
      const payload = text.split(/\s+/)[1] ?? '';
      if (payload.startsWith('m_')) {
        const marketer = await this.prisma.marketer.findUnique({ where: { telegramLinkCode: payload.slice(2) } });
        if (!marketer) return this.bot.replyNow(chatId, 'This link is not valid any more.');
        await this.prisma.marketer.update({ where: { id: marketer.id }, data: { telegramChatId: String(chatId) } });
        await this.audit(this.prisma, 'marketer', marketer.id, 'telegram_connected', 'marketer', marketer.id);
        return this.bot.replyNow(chatId,
          `✅ Connected, ${marketer.name}. You'll get a message here for every inquiry, sale, cancellation and payout on your codes.`);
      }
      if (payload.startsWith('i_')) {
        const inquiry = await this.prisma.inquiry.findUnique({ where: { customerLinkCode: payload.slice(2) } });
        if (!inquiry) return this.bot.replyNow(chatId, 'This link is not valid any more.');
        await this.prisma.inquiry.update({ where: { id: inquiry.id }, data: { customerChatId: String(chatId) } });
        return this.bot.replyNow(chatId,
          `✅ Abron Shop: you'll receive updates here about your request for ${inquiry.productName}.`);
      }
      return this.bot.replyNow(chatId, 'Welcome to Abron Shop! Browse products at ' + this.siteUrl());
    }

    const callback = update.callback_query;
    const match = callback?.data?.match(/^cc:([0-9a-f-]{36}):([yn])$/);
    if (!callback || !match) return;
    const [, inquiryId, answer] = match;
    const source = callback.message
      ? { chatId: callback.message.chat.id, messageId: callback.message.message_id }
      : undefined;

    const result = await this.prisma.$transaction(async (tx) => {
      const inquiry = await this.loadInquiry(tx, inquiryId).catch(() => null);
      if (!inquiry || inquiry.customerChatId !== String(callback.from.id)) return 'invalid';
      if (inquiry.status !== 'cancelled' || inquiry.customerConfirmation) return 'stale';
      const confirmation = answer === 'y' ? 'confirmed' : 'disputed';
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { customerConfirmation: confirmation, customerConfirmedAt: new Date() },
      });
      const marketerId = inquiry.promoCode?.marketerId;
      await this.audit(tx, 'inquiry', inquiryId, `customer_${confirmation}`, 'customer', marketerId);
      if (confirmation === 'disputed') {
        if (inquiry.promoCode) {
          await this.createDispute(tx, inquiry, 'customer', 'Customer answered "No, I bought it" on Telegram');
        } else {
          await this.bot.enqueue(tx, this.bot.adminChatId(),
            `⚠️ Customer ${inquiry.fullName} (${inquiry.phone}) says they DID buy ${inquiry.productName}, but the inquiry is cancelled.`);
        }
      } else if (inquiry.promoCode?.marketer) {
        await this.bot.enqueue(tx, inquiry.promoCode.marketer.telegramChatId,
          `ℹ️ The customer for ${inquiry.productName} confirmed on Telegram that they did not buy.`);
      }
      return confirmation;
    });
    this.bot.wake();
    const reply = result === 'confirmed'
      ? 'Thank you for confirming.'
      : result === 'disputed'
        ? 'Thank you. We will review this and contact you.'
        : result === 'stale'
          ? 'This request was already answered or has changed.'
          : 'This button is not valid for you.';
    await this.bot.answerCallback(callback.id, reply, result === 'invalid' ? undefined : source);
  }

  // ───────────────────────── marketers (admin) ─────────────────────────

  private marketerData(dto: CreateMarketerDto | UpdateMarketerDto) {
    return {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.phone !== undefined && { phone: dto.phone.trim(), phoneKey: phoneKey(dto.phone) }),
      ...(dto.telegram !== undefined && { telegram: dto.telegram?.trim() || null }),
      ...(dto.payout_method !== undefined && { payoutMethod: dto.payout_method?.trim() || null }),
      ...(dto.payout_account !== undefined && { payoutAccount: dto.payout_account?.trim() || null }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      ...(dto.is_active !== undefined && { isActive: dto.is_active }),
    };
  }

  async createMarketer(dto: CreateMarketerDto, actor: string) {
    const token = randomToken();
    const marketer = await this.prisma.marketer.create({
      data: {
        ...(this.marketerData(dto) as Prisma.MarketerCreateInput),
        portalTokenHash: sha256(token),
        telegramLinkCode: randomToken(12),
      },
    });
    await this.audit(this.prisma, 'marketer', marketer.id, 'created', actor, marketer.id);
    return { marketer, portal_url: this.portalUrl(token) };
  }

  async updateMarketer(id: string, dto: UpdateMarketerDto, actor: string) {
    const before = await this.prisma.marketer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Marketer not found');
    const marketer = await this.prisma.marketer.update({ where: { id }, data: this.marketerData(dto) });
    await this.audit(this.prisma, 'marketer', id, 'updated', actor, id, {
      fields: Object.keys(dto),
      ...(dto.is_active !== undefined && dto.is_active !== before.isActive && { is_active: dto.is_active }),
    });
    return marketer;
  }

  async regeneratePortalLink(id: string, actor: string) {
    const token = randomToken();
    await this.prisma.marketer.update({ where: { id }, data: { portalTokenHash: sha256(token) } });
    await this.audit(this.prisma, 'marketer', id, 'portal_link_regenerated', actor, id);
    return { portal_url: this.portalUrl(token) };
  }

  telegramConnectUrl(marketer: { telegramLinkCode: string }) {
    return this.bot.deepLink(`m_${marketer.telegramLinkCode}`);
  }

  private async commissionTotals(where: Prisma.CommissionWhereInput) {
    const groups = await this.prisma.commission.groupBy({
      by: ['marketerId', 'status'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });
    const totals = new Map<string, Record<string, number>>();
    for (const group of groups) {
      const row = totals.get(group.marketerId) ?? { pending: 0, approved: 0, paid: 0, void: 0 };
      row[group.status] = money(group._sum.amount) ?? 0;
      totals.set(group.marketerId, row);
    }
    return totals;
  }

  async listMarketers() {
    await this.approveEligibleCommissions();
    const marketers = await this.prisma.marketer.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        promoCodes: { orderBy: { createdAt: 'asc' } },
        _count: { select: { disputes: { where: { status: 'open' } } } },
      },
    });
    const totals = await this.commissionTotals({});
    const inquiryCounts = await this.prisma.inquiry.groupBy({
      by: ['promoCodeId', 'status'],
      where: { promoCodeId: { not: null } },
      _count: { _all: true },
    });
    const visitCounts = await this.prisma.promoVisit.groupBy({ by: ['promoCodeId'], _count: { _all: true } });
    const visits = new Map(visitCounts.map((v) => [v.promoCodeId, v._count._all]));

    return marketers.map((m) => {
      const codeIds = new Set(m.promoCodes.map((c) => c.id));
      const counts = { inquiries: 0, sold: 0, cancelled: 0 };
      for (const row of inquiryCounts) {
        if (!row.promoCodeId || !codeIds.has(row.promoCodeId)) continue;
        counts.inquiries += row._count._all;
        if (row.status === 'confirmed' || row.status === 'delivered') counts.sold += row._count._all;
        if (row.status === 'cancelled') counts.cancelled += row._count._all;
      }
      return {
        ...this.marketerJson(m),
        open_disputes: m._count.disputes,
        codes: m.promoCodes.map((c) => this.codeJson(c, visits.get(c.id) ?? 0)),
        stats: { ...counts, visits: m.promoCodes.reduce((sum, c) => sum + (visits.get(c.id) ?? 0), 0) },
        commissions: totals.get(m.id) ?? { pending: 0, approved: 0, paid: 0, void: 0 },
      };
    });
  }

  marketerJson(m: Prisma.MarketerGetPayload<object>) {
    return {
      id: m.id,
      name: m.name,
      phone: m.phone,
      telegram: m.telegram,
      payout_method: m.payoutMethod,
      payout_account: m.payoutAccount,
      notes: m.notes,
      is_active: m.isActive,
      telegram_connected: Boolean(m.telegramChatId),
      telegram_connect_url: this.telegramConnectUrl(m),
      created_at: m.createdAt,
    };
  }

  codeJson(c: Prisma.PromoCodeGetPayload<object>, visits = 0, uses?: number) {
    return {
      id: c.id,
      code: c.code,
      marketer_id: c.marketerId,
      discount_type: c.discountType,
      discount_value: money(c.discountValue),
      discount_label: this.describeDiscount(c),
      commission_amount: money(c.commissionAmount),
      starts_at: c.startsAt,
      ends_at: c.endsAt,
      max_uses: c.maxUses,
      is_active: c.isActive,
      share_url: this.shareUrl(c.code),
      visits,
      ...(uses !== undefined && { uses }),
      created_at: c.createdAt,
    };
  }

  async marketerDetail(id: string) {
    await this.approveEligibleCommissions();
    const marketer = await this.prisma.marketer.findUnique({ where: { id } });
    if (!marketer) throw new NotFoundException('Marketer not found');
    const [commissions, payouts] = await Promise.all([
      this.prisma.commission.findMany({
        where: { marketerId: id },
        orderBy: { createdAt: 'desc' },
        include: { inquiry: { select: { productName: true, fullName: true, status: true, quantity: true } } },
      }),
      this.prisma.payout.findMany({ where: { marketerId: id }, orderBy: { paidAt: 'desc' } }),
    ]);
    return {
      marketer: this.marketerJson(marketer),
      commissions: commissions.map((c) => ({
        id: c.id,
        inquiry_id: c.inquiryId,
        product_name: c.inquiry.productName,
        customer: c.inquiry.fullName,
        quantity: c.inquiry.quantity,
        inquiry_status: c.inquiry.status,
        ...this.commissionJson(c),
      })),
      payouts: payouts.map((p) => this.payoutJson(p)),
    };
  }

  commissionJson(c: Prisma.CommissionGetPayload<object>) {
    return {
      amount: money(c.amount),
      base_amount: money(c.baseAmount),
      is_penalty: c.isPenalty,
      status: c.status,
      eligible_at: c.eligibleAt,
      void_reason: c.voidReason,
      payout_id: c.payoutId,
      created_at: c.createdAt,
    };
  }

  payoutJson(p: Prisma.PayoutGetPayload<object>) {
    return {
      id: p.id,
      amount: money(p.amount),
      method: p.method,
      transaction_ref: p.transactionRef,
      receipt_url: p.receiptUrl,
      note: p.note,
      paid_at: p.paidAt,
    };
  }

  // ───────────────────────── promo codes (admin) ─────────────────────────

  private checkCodeValues(type: string | undefined, value: number | undefined, startsAt?: string | null, endsAt?: string | null) {
    if (type === 'PERCENT' && value !== undefined && value > 100) {
      throw new BadRequestException('A percent discount cannot be more than 100');
    }
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      throw new BadRequestException('End date must be after start date');
    }
  }

  async createCode(dto: CreatePromoCodeDto, actor: string) {
    this.checkCodeValues(dto.discount_type, dto.discount_value, dto.starts_at, dto.ends_at);
    const code = normalizeCode(dto.code);
    const marketer = await this.prisma.marketer.findUnique({ where: { id: dto.marketer_id } });
    if (!marketer) throw new NotFoundException('Marketer not found');
    if (await this.prisma.promoCode.findUnique({ where: { code } })) {
      throw new BadRequestException('This code already exists');
    }
    const row = await this.prisma.promoCode.create({
      data: {
        code,
        marketerId: marketer.id,
        discountType: dto.discount_type,
        discountValue: dto.discount_value,
        commissionAmount: dto.commission_amount,
        startsAt: dto.starts_at ? new Date(dto.starts_at) : null,
        endsAt: dto.ends_at ? new Date(dto.ends_at) : null,
        maxUses: dto.max_uses ?? null,
        isActive: dto.is_active ?? true,
      },
    });
    await this.audit(this.prisma, 'promo_code', row.id, 'created', actor, marketer.id, {
      code,
      discount: this.describeDiscount(row),
      commission_amount: dto.commission_amount,
    });
    await this.bot.enqueue(this.prisma, marketer.telegramChatId, [
      `🎟 New promo code: ${code}`,
      `Customer discount: ${this.describeDiscount(row)}`,
      `Your commission: ${formatAmount(dto.commission_amount)} per item sold`,
      `Share link: ${this.shareUrl(code)}`,
    ].join('\n'));
    this.bot.wake();
    return this.codeJson(row);
  }

  async updateCode(id: string, dto: UpdatePromoCodeDto, actor: string) {
    const before = await this.prisma.promoCode.findUnique({ where: { id }, include: { marketer: true } });
    if (!before) throw new NotFoundException('Promo code not found');
    this.checkCodeValues(
      dto.discount_type ?? before.discountType,
      dto.discount_value ?? money(before.discountValue) ?? undefined,
      dto.starts_at === undefined ? before.startsAt?.toISOString() : dto.starts_at,
      dto.ends_at === undefined ? before.endsAt?.toISOString() : dto.ends_at,
    );
    const row = await this.prisma.promoCode.update({
      where: { id },
      data: {
        ...(dto.discount_type !== undefined && { discountType: dto.discount_type }),
        ...(dto.discount_value !== undefined && { discountValue: dto.discount_value }),
        ...(dto.commission_amount !== undefined && { commissionAmount: dto.commission_amount }),
        ...(dto.starts_at !== undefined && { startsAt: dto.starts_at ? new Date(dto.starts_at) : null }),
        ...(dto.ends_at !== undefined && { endsAt: dto.ends_at ? new Date(dto.ends_at) : null }),
        ...(dto.max_uses !== undefined && { maxUses: dto.max_uses ?? null }),
        ...(dto.is_active !== undefined && { isActive: dto.is_active }),
      },
    });
    const changes: Record<string, unknown> = {};
    if (dto.commission_amount !== undefined && dto.commission_amount !== money(before.commissionAmount)) {
      changes.commission_amount = { from: money(before.commissionAmount), to: dto.commission_amount };
    }
    if (this.describeDiscount(before) !== this.describeDiscount(row)) {
      changes.discount = { from: this.describeDiscount(before), to: this.describeDiscount(row) };
    }
    if (dto.is_active !== undefined && dto.is_active !== before.isActive) changes.is_active = dto.is_active;
    if (Object.keys(changes).length || Object.keys(dto).length) {
      await this.audit(this.prisma, 'promo_code', id, 'updated', actor, before.marketerId, { code: row.code, ...changes });
    }
    if (Object.keys(changes).length) {
      await this.bot.enqueue(this.prisma, before.marketer.telegramChatId, [
        `✏️ Your code ${row.code} was updated`,
        changes.discount ? `Customer discount: ${this.describeDiscount(row)}` : '',
        changes.commission_amount ? `Commission: ${formatAmount(row.commissionAmount)} per item (applies to new inquiries only)` : '',
        changes.is_active !== undefined ? `Status: ${row.isActive ? 'active' : 'paused'}` : '',
      ].filter(Boolean).join('\n'));
      this.bot.wake();
    }
    return this.codeJson(row);
  }

  // ───────────────────────── payouts + disputes (admin) ─────────────────────────

  async createPayout(marketerId: string, dto: CreatePayoutDto, actor: string) {
    await this.approveEligibleCommissions();
    return this.run(async (tx) => {
      const marketer = await tx.marketer.findUnique({ where: { id: marketerId } });
      if (!marketer) throw new NotFoundException('Marketer not found');
      const approved = await tx.commission.findMany({
        where: { marketerId, status: 'approved', payoutId: null },
      });
      if (approved.length === 0) throw new BadRequestException('There are no approved commissions to pay');
      const amount = approved.reduce((sum, c) => sum.add(c.amount), new Prisma.Decimal(0));
      const payout = await tx.payout.create({
        data: {
          marketerId,
          amount,
          method: dto.method.trim(),
          transactionRef: dto.transaction_ref.trim(),
          receiptUrl: dto.receipt_url?.trim() || null,
          note: dto.note?.trim() || null,
        },
      });
      const updated = await tx.commission.updateMany({
        where: { id: { in: approved.map((c) => c.id) }, status: 'approved', payoutId: null },
        data: { status: 'paid', payoutId: payout.id },
      });
      if (updated.count !== approved.length) throw new BadRequestException('Commissions changed; please retry');
      await this.audit(tx, 'payout', payout.id, 'paid', actor, marketerId, {
        amount: money(amount),
        method: payout.method,
        transaction_ref: payout.transactionRef,
        commission_ids: approved.map((c) => c.id),
      });
      await this.bot.enqueue(tx, marketer.telegramChatId, [
        `💸 Payout sent: ${formatAmount(amount)}`,
        `Method: ${payout.method}`,
        `Transaction reference: ${payout.transactionRef}`,
        `Covers ${approved.length} sale(s). Details are on your partner page.`,
      ].join('\n'));
      return this.payoutJson(payout);
    });
  }

  async listDisputes() {
    const rows = await this.prisma.dispute.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: {
        marketer: { select: { name: true } },
        inquiry: {
          select: {
            id: true,
            productName: true,
            fullName: true,
            phone: true,
            status: true,
            cancelReason: true,
            cancelNote: true,
            quantity: true,
            commissionPerItem: true,
            promoCodeText: true,
            quotedPrice: true,
            listPrice: true,
            currency: true,
            customerConfirmation: true,
          },
        },
      },
    });
    const multiplier = this.terms().dispute_multiplier;
    return rows.map((d) => ({
      id: d.id,
      source: d.source,
      note: d.note,
      status: d.status,
      admin_response: d.adminResponse,
      resolved_at: d.resolvedAt,
      created_at: d.createdAt,
      marketer_name: d.marketer.name,
      inquiry: {
        id: d.inquiry.id,
        product_name: d.inquiry.productName,
        customer: d.inquiry.fullName,
        phone: d.inquiry.phone,
        status: d.inquiry.status,
        cancel_reason: d.inquiry.cancelReason,
        cancel_note: d.inquiry.cancelNote,
        code: d.inquiry.promoCodeText,
        quoted_price: money(d.inquiry.quotedPrice ?? d.inquiry.listPrice),
        currency: d.inquiry.currency,
        customer_confirmation: d.inquiry.customerConfirmation,
      },
      penalty_amount: d.inquiry.commissionPerItem
        ? (money(d.inquiry.commissionPerItem) ?? 0) * d.inquiry.quantity * multiplier
        : null,
    }));
  }

  // ───────────────────────── marketer portal (public, private link) ─────────────────────────

  private async marketerByToken(token: string) {
    if (!token || token.length < 20) throw new NotFoundException('Partner page not found');
    const marketer = await this.prisma.marketer.findUnique({ where: { portalTokenHash: sha256(token) } });
    if (!marketer) throw new NotFoundException('Partner page not found');
    return marketer;
  }

  async portal(token: string) {
    const marketer = await this.marketerByToken(token);
    await this.approveEligibleCommissions();
    const id = marketer.id;
    const [codes, inquiries, payouts, history] = await Promise.all([
      this.prisma.promoCode.findMany({
        where: { marketerId: id },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { visits: true, inquiries: { where: { attributionSource: 'code' } } } },
        },
      }),
      this.prisma.inquiry.findMany({
        where: { promoCode: { marketerId: id } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        include: { commission: true, disputes: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.payout.findMany({ where: { marketerId: id }, orderBy: { paidAt: 'desc' } }),
      this.prisma.auditEvent.findMany({ where: { marketerId: id }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);

    const totals = { pending: 0, approved: 0, paid: 0, void: 0 };
    const counts = { inquiries: inquiries.length, sold: 0, cancelled: 0, open: 0 };
    for (const inquiry of inquiries) {
      if (inquiry.status === 'confirmed' || inquiry.status === 'delivered') counts.sold += 1;
      else if (inquiry.status === 'cancelled') counts.cancelled += 1;
      else counts.open += 1;
      if (inquiry.commission) totals[inquiry.commission.status] += money(inquiry.commission.amount) ?? 0;
    }

    return {
      marketer: {
        name: marketer.name,
        is_active: marketer.isActive,
        telegram_connected: Boolean(marketer.telegramChatId),
        telegram_connect_url: this.telegramConnectUrl(marketer),
      },
      terms: this.terms(),
      codes: codes.map((c) => this.codeJson(c, c._count.visits, c._count.inquiries)),
      stats: { ...counts, visits: codes.reduce((sum, c) => sum + c._count.visits, 0) },
      commissions: totals,
      inquiries: inquiries.map((inquiry) => {
        const blocking = inquiry.disputes.find((d) => d.status === 'open' || d.status === 'accepted');
        return {
          id: inquiry.id,
          created_at: inquiry.createdAt,
          product_name: inquiry.productName,
          customer: maskName(inquiry.fullName),
          phone: maskPhone(inquiry.phone),
          code: inquiry.promoCodeText,
          attribution: inquiry.attributionSource,
          status: inquiry.status,
          quantity: inquiry.quantity,
          currency: inquiry.currency,
          list_price: money(inquiry.listPrice),
          quoted_price: money(inquiry.quotedPrice),
          final_amount: money(inquiry.finalAmount),
          cancel_reason: inquiry.cancelReason ? CANCEL_REASON_LABELS[inquiry.cancelReason] : null,
          cancel_note: inquiry.cancelNote,
          cancelled_at: inquiry.cancelledAt,
          confirmed_at: inquiry.confirmedAt,
          delivered_at: inquiry.deliveredAt,
          customer_confirmation: inquiry.customerConfirmation,
          customer_on_telegram: Boolean(inquiry.customerChatId),
          commission: inquiry.commission ? this.commissionJson(inquiry.commission) : null,
          disputes: inquiry.disputes.map((d) => ({
            id: d.id,
            source: d.source,
            note: d.note,
            status: d.status,
            admin_response: d.adminResponse,
            created_at: d.createdAt,
            resolved_at: d.resolvedAt,
          })),
          can_dispute: (inquiry.status === 'cancelled' || inquiry.status === 'closed') && !blocking,
        };
      }),
      payouts: payouts.map((p) => this.payoutJson(p)),
      history: history.map((event) => ({
        id: event.id,
        entity: event.entity,
        entity_id: event.entityId,
        action: event.action,
        by: event.actor.startsWith('admin:') ? 'Shop admin' : event.actor,
        detail: event.detail,
        created_at: event.createdAt,
      })),
    };
  }

  async portalOpenDispute(token: string, dto: OpenDisputeDto) {
    const marketer = await this.marketerByToken(token);
    const dispute = await this.run(async (tx) => {
      const inquiry = await this.loadInquiry(tx, dto.inquiry_id);
      if (inquiry.promoCode?.marketerId !== marketer.id) throw new NotFoundException('Inquiry not found');
      if (inquiry.status !== 'cancelled' && inquiry.status !== 'closed') {
        throw new BadRequestException('Only cancelled inquiries can be disputed');
      }
      const existing = await tx.dispute.findFirst({
        where: { inquiryId: inquiry.id, status: { in: ['open', 'accepted'] } },
      });
      if (existing) throw new BadRequestException('A dispute is already open for this inquiry');
      return this.createDispute(tx, inquiry, 'marketer', dto.note?.trim() || null);
    });
    return { id: dispute.id, status: dispute.status };
  }
}
