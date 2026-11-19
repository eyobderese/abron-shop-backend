-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('website', 'admin');

-- CreateEnum
CREATE TYPE "AttributionSource" AS ENUM ('code', 'phone');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'approved', 'paid', 'void');

-- CreateEnum
CREATE TYPE "CustomerConfirmation" AS ENUM ('confirmed', 'disputed');

-- CreateEnum
CREATE TYPE "DisputeSource" AS ENUM ('marketer', 'customer');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('no_answer', 'changed_mind', 'price', 'out_of_stock', 'duplicate', 'returned', 'other');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InquiryStatus" ADD VALUE 'confirmed';
ALTER TYPE "InquiryStatus" ADD VALUE 'delivered';
ALTER TYPE "InquiryStatus" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "attribution_source" "AttributionSource",
ADD COLUMN     "cancel_note" TEXT,
ADD COLUMN     "cancel_reason" "CancelReason",
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "commission_per_item" DECIMAL(10,2),
ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "currency" "ProductCurrency",
ADD COLUMN     "customer_chat_id" TEXT,
ADD COLUMN     "customer_confirmation" "CustomerConfirmation",
ADD COLUMN     "customer_confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "customer_link_code" TEXT,
ADD COLUMN     "delivered_at" TIMESTAMPTZ(6),
ADD COLUMN     "discount_amount" DECIMAL(10,2),
ADD COLUMN     "final_amount" DECIMAL(10,2),
ADD COLUMN     "list_price" DECIMAL(10,2),
ADD COLUMN     "phone_key" TEXT,
ADD COLUMN     "promo_code_id" UUID,
ADD COLUMN     "promo_code_text" TEXT,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "quoted_price" DECIMAL(10,2),
ADD COLUMN     "source" "InquirySource" NOT NULL DEFAULT 'website';

-- CreateTable
CREATE TABLE "marketers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_key" TEXT,
    "telegram" TEXT,
    "payout_method" TEXT,
    "payout_account" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "portal_token_hash" TEXT NOT NULL,
    "telegram_link_code" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "marketer_id" UUID NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "commission_amount" DECIMAL(10,2) NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promo_code_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marketer_id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "base_amount" DECIMAL(10,2) NOT NULL,
    "is_penalty" BOOLEAN NOT NULL DEFAULT false,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "eligible_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "payout_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "marketer_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "transaction_ref" TEXT NOT NULL,
    "receipt_url" TEXT,
    "note" TEXT,
    "paid_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiry_id" UUID NOT NULL,
    "marketer_id" UUID NOT NULL,
    "source" "DisputeSource" NOT NULL,
    "note" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "admin_response" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "marketer_id" UUID,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reply_markup" JSONB,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketers_portal_token_hash_key" ON "marketers"("portal_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "marketers_telegram_link_code_key" ON "marketers"("telegram_link_code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_marketer_id_idx" ON "promo_codes"("marketer_id");

-- CreateIndex
CREATE INDEX "promo_visits_promo_code_id_created_at_idx" ON "promo_visits"("promo_code_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_inquiry_id_key" ON "commissions"("inquiry_id");

-- CreateIndex
CREATE INDEX "commissions_marketer_id_status_idx" ON "commissions"("marketer_id", "status");

-- CreateIndex
CREATE INDEX "commissions_status_eligible_at_idx" ON "commissions"("status", "eligible_at");

-- CreateIndex
CREATE INDEX "payouts_marketer_id_paid_at_idx" ON "payouts"("marketer_id", "paid_at" DESC);

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "disputes_marketer_id_created_at_idx" ON "disputes"("marketer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_entity_entity_id_created_at_idx" ON "audit_events"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_marketer_id_created_at_idx" ON "audit_events"("marketer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "telegram_outbox_status_next_attempt_at_idx" ON "telegram_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_customer_link_code_key" ON "inquiries"("customer_link_code");

-- CreateIndex
CREATE INDEX "inquiries_promo_code_id_created_at_idx" ON "inquiries"("promo_code_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inquiries_phone_key_created_at_idx" ON "inquiries"("phone_key", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_marketer_id_fkey" FOREIGN KEY ("marketer_id") REFERENCES "marketers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_visits" ADD CONSTRAINT "promo_visits_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_marketer_id_fkey" FOREIGN KEY ("marketer_id") REFERENCES "marketers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_marketer_id_fkey" FOREIGN KEY ("marketer_id") REFERENCES "marketers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_marketer_id_fkey" FOREIGN KEY ("marketer_id") REFERENCES "marketers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: customer phone key (last 9 digits) for existing inquiries.
UPDATE "inquiries"
SET "phone_key" = right(regexp_replace("phone", '\D', '', 'g'), 9)
WHERE "phone_key" IS NULL AND length(regexp_replace("phone", '\D', '', 'g')) >= 9;
