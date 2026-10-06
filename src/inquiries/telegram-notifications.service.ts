import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 10_000;
const STALE_LOCK_MS = 2 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type TelegramResponse = {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number };
};

@Injectable()
export class TelegramNotificationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramNotificationsService.name);
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.enabled = ['true', '1', 'yes', 'on'].includes(
      this.config.get<string>('TELEGRAM_NOTIFICATIONS_ENABLED', 'false').toLowerCase(),
    );
  }

  isEnabled() {
    return this.enabled;
  }

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Telegram inquiry notifications are disabled');
      return;
    }

    this.logger.log('Telegram inquiry notification worker started');
    this.timer = setInterval(() => void this.drainQueue(), POLL_INTERVAL_MS);
    void this.drainQueue();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  wake() {
    if (this.enabled) void this.drainQueue();
  }

  private async drainQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      for (let processed = 0; processed < 10; processed += 1) {
        const notification = await this.claimNext();
        if (!notification) break;
        await this.deliver(notification.id);
      }
    } catch (error) {
      this.logger.error(`Telegram notification worker failed: ${this.errorMessage(error)}`);
    } finally {
      this.processing = false;
    }
  }

  private async claimNext() {
    for (let tries = 0; tries < 5; tries += 1) {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
      const candidate = await this.prisma.inquiryNotification.findFirst({
        where: {
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'sending', lockedAt: { lte: staleBefore } },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, status: true, lockedAt: true },
      });
      if (!candidate) return null;

      const claimed = await this.prisma.inquiryNotification.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          ...(candidate.status === 'sending'
            ? { lockedAt: candidate.lockedAt }
            : { nextAttemptAt: { lte: now } }),
        },
        data: {
          status: 'sending',
          lockedAt: now,
          attempts: { increment: 1 },
        },
      });
      if (claimed.count === 1) return { id: candidate.id };
    }

    return null;
  }

  private async deliver(notificationId: string) {
    const notification = await this.prisma.inquiryNotification.findUnique({
      where: { id: notificationId },
      include: {
        inquiry: {
          include: {
            product: {
              select: { brand: true, price: true, currency: true, slug: true },
            },
          },
        },
      },
    });
    if (!notification || notification.status !== 'sending') return;

    try {
      const messageId = await this.sendMessage(this.formatMessage(notification.inquiry));
      await this.prisma.inquiryNotification.update({
        where: { id: notification.id },
        data: {
          status: 'sent',
          providerMessageId: messageId,
          sentAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const finalAttempt = notification.attempts >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.max(0, notification.attempts - 1)] ?? 0;
      await this.prisma.inquiryNotification.update({
        where: { id: notification.id },
        data: {
          status: finalAttempt ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + delay),
          lockedAt: null,
          lastError: this.errorMessage(error).slice(0, 1000),
        },
      });
      this.logger.warn(
        `Telegram notification ${notification.id} failed on attempt ${notification.attempts}`,
      );
    }
  }

  private async sendMessage(text: string) {
    const token = this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.getOrThrow<string>('TELEGRAM_ADMIN_CHAT_ID');
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramResponse;
    if (!response.ok || !payload.ok || !payload.result?.message_id) {
      throw new Error(payload.description || `Telegram returned HTTP ${response.status}`);
    }
    return String(payload.result.message_id);
  }

  private formatMessage(inquiry: {
    id: string;
    productName: string;
    fullName: string;
    phone: string;
    telegram: string;
    selectedSize: string | null;
    selectedColor: string | null;
    message: string | null;
    product: {
      brand: string | null;
      price: { toString(): string } | null;
      currency: string;
      slug: string;
    } | null;
  }) {
    const adminUrl = this.config.get<string>(
      'TELEGRAM_ADMIN_URL',
      'https://abronshop.online/admin/inquiries',
    );
    const price = inquiry.product?.price
      ? `${Number(inquiry.product.price.toString()).toLocaleString('en-US')} ${inquiry.product.currency}`
      : 'Not set';
    const lines = [
      '🛍 New Abron Shop inquiry',
      '',
      `Product: ${inquiry.productName}`,
      `Brand: ${inquiry.product?.brand || 'Not set'}`,
      `Color: ${inquiry.selectedColor || 'Not selected'}`,
      `Size: ${inquiry.selectedSize || 'Not selected'}`,
      `Price: ${price}`,
      '',
      `Customer: ${inquiry.fullName}`,
      `Phone: ${inquiry.phone}`,
      `Telegram: ${inquiry.telegram}`,
      `Message: ${inquiry.message || 'No message'}`,
      '',
      `Inquiry ID: ${inquiry.id}`,
      `Open inquiries: ${adminUrl}`,
    ];

    return lines.join('\n').slice(0, 4000);
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown notification error';
  }
}
