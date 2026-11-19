import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromoModule } from '../promo/promo.module';
import { InquiriesController } from './inquiries.controller';
import { TelegramNotificationsService } from './telegram-notifications.service';

@Module({
  imports: [AuthModule, PromoModule],
  controllers: [InquiriesController],
  providers: [TelegramNotificationsService],
})
export class InquiriesModule {}
