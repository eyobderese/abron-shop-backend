import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 10_000;
const STALE_LOCK_MS = 2 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type Db = Prisma.TransactionClient | PrismaService;

export type InlineKeyboard = {
  inline_keyboard: { text: string; callback_data: string }[][];
};

export type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number; type?: string }; from?: { id: number }; text?: string };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

type UpdateHandler = (update: TelegramUpdate) => Promise<void>;

/**
 * Transport for marketer + customer Telegram messages.
 * - Outbound: rows in `telegram_outbox`, drained with retries (same pattern as the admin
 *   inquiry notifications), so a Telegram outage never loses a message.
 * - Inbound: optional long polling of getUpdates for /start deep links and button presses.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly token: string | undefined;
  private readonly sendEnabled: boolean;
  private readonly updatesEnabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private processing = false;
  private polling = false;
  private stopped = false;
  private handler: UpdateHandler | null = null;
  private tickHooks: (() => Promise<void>)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const on = (key: string, fallback = 'false') =>
      ['true', '1', 'yes', 'on'].includes(this.config.get<string>(key, fallback).toLowerCase());
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.sendEnabled = Boolean(this.token) && on('TELEGRAM_NOTIFICATIONS_ENABLED');
    this.updatesEnabled = this.sendEnabled && on('TELEGRAM_BOT_UPDATES_ENABLED');
  }

  /** True when the bot can receive /start links (needed for marketer/customer linking). */
  canLink() {
    return this.updatesEnabled && Boolean(this.botUsername());
  }

  botUsername() {
    return (this.config.get<string>('TELEGRAM_BOT_USERNAME') || '').replace(/^@/, '') || null;
  }

  deepLink(payload: string) {
    const username = this.botUsername();
    return this.canLink() && username ? `https://t.me/${username}?start=${payload}` : null;
  }

  adminChatId() {
    return this.config.get<string>('TELEGRAM_ADMIN_CHAT_ID') || null;
  }

  setUpdateHandler(handler: UpdateHandler) {
    this.handler = handler;
  }

  /** Work to run on each worker tick (e.g. approving commissions after the hold period). */
  onTick(hook: () => Promise<void>) {
    this.tickHooks.push(hook);
  }

  async enqueue(db: Db, chatId: string | null | undefined, text: string, replyMarkup?: InlineKeyboard) {
    if (!this.sendEnabled || !chatId) return;
    await db.telegramOutbox.create({
      data: {
        chatId,
        text: text.slice(0, 4000),
        ...(replyMarkup && { replyMarkup: replyMarkup as unknown as Prisma.InputJsonValue }),
      },
    });
  }

  wake() {
    if (this.sendEnabled) void this.drainQueue();
  }

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    void this.tick();
    if (this.updatesEnabled) {
      this.logger.log('Telegram bot update polling started');
      void this.pollUpdates();
    }
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    for (const hook of this.tickHooks) {
      await hook().catch((error) => this.logger.error(`Tick hook failed: ${this.err(error)}`));
    }
    if (this.sendEnabled) await this.drainQueue();
  }

  private async drainQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      for (let processed = 0; processed < 20; processed += 1) {
        const id = await this.claimNext();
        if (!id) break;
        await this.deliver(id);
      }
    } catch (error) {
      this.logger.error(`Telegram outbox worker failed: ${this.err(error)}`);
    } finally {
      this.processing = false;
    }
  }

  private async claimNext() {
    for (let tries = 0; tries < 5; tries += 1) {
      const now = new Date();
      const candidate = await this.prisma.telegramOutbox.findFirst({
        where: {
          attempts: { lt: MAX_ATTEMPTS },
          OR: [
            { status: 'pending', nextAttemptAt: { lte: now } },
            { status: 'sending', lockedAt: { lte: new Date(now.getTime() - STALE_LOCK_MS) } },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, status: true, lockedAt: true },
      });
      if (!candidate) return null;
      const claimed = await this.prisma.telegramOutbox.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          ...(candidate.status === 'sending'
            ? { lockedAt: candidate.lockedAt }
            : { nextAttemptAt: { lte: now } }),
        },
        data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
      });
      if (claimed.count === 1) return candidate.id;
    }
    return null;
  }

  private async deliver(id: string) {
    const row = await this.prisma.telegramOutbox.findUnique({ where: { id } });
    if (!row || row.status !== 'sending') return;
    try {
      await this.call('sendMessage', {
        chat_id: row.chatId,
        text: row.text,
        disable_web_page_preview: true,
        ...(row.replyMarkup ? { reply_markup: row.replyMarkup } : {}),
      });
      await this.prisma.telegramOutbox.update({
        where: { id },
        data: { status: 'sent', sentAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (error) {
      const finalAttempt = row.attempts >= MAX_ATTEMPTS;
      const delay = RETRY_DELAYS_MS[Math.max(0, row.attempts - 1)] ?? 0;
      await this.prisma.telegramOutbox.update({
        where: { id },
        data: {
          status: finalAttempt ? 'failed' : 'pending',
          nextAttemptAt: new Date(Date.now() + delay),
          lockedAt: null,
          lastError: this.err(error).slice(0, 1000),
        },
      });
    }
  }

  /** Immediate reply (used inside update handling, where the user is waiting). */
  async replyNow(chatId: number | string, text: string) {
    try {
      await this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
    } catch (error) {
      this.logger.warn(`Telegram reply failed: ${this.err(error)}`);
    }
  }

  async answerCallback(callbackId: string, text: string, removeButtonsFrom?: { chatId: number; messageId: number }) {
    try {
      await this.call('answerCallbackQuery', { callback_query_id: callbackId, text });
      if (removeButtonsFrom) {
        await this.call('editMessageReplyMarkup', {
          chat_id: removeButtonsFrom.chatId,
          message_id: removeButtonsFrom.messageId,
          reply_markup: { inline_keyboard: [] },
        });
      }
    } catch (error) {
      this.logger.warn(`Telegram callback answer failed: ${this.err(error)}`);
    }
  }

  private async pollUpdates() {
    if (this.polling) return;
    this.polling = true;
    let offset = 0;
    while (!this.stopped) {
      try {
        const updates = (await this.call(
          'getUpdates',
          { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          35_000,
        )) as TelegramUpdate[];
        for (const update of updates) {
          offset = update.update_id + 1;
          if (this.handler) {
            await this.handler(update).catch((error) =>
              this.logger.error(`Telegram update ${update.update_id} failed: ${this.err(error)}`),
            );
          }
        }
      } catch (error) {
        if (this.stopped) break;
        this.logger.warn(`Telegram getUpdates failed: ${this.err(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    this.polling = false;
  }

  private async call(method: string, body: Record<string, unknown>, timeoutMs = 8_000) {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: unknown;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.description || `Telegram returned HTTP ${response.status}`);
    }
    return payload.result;
  }

  private err(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown Telegram error';
  }
}
