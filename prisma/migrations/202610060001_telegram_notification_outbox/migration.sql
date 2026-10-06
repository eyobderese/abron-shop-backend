CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('pending', 'sending', 'sent', 'failed');

CREATE TABLE "inquiry_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiry_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inquiry_notifications_inquiry_id_channel_key"
ON "inquiry_notifications"("inquiry_id", "channel");

CREATE INDEX "inquiry_notifications_status_next_attempt_at_idx"
ON "inquiry_notifications"("status", "next_attempt_at");

ALTER TABLE "inquiry_notifications"
ADD CONSTRAINT "inquiry_notifications_inquiry_id_fkey"
FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
