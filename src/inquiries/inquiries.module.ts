import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InquiriesController } from './inquiries.controller';
import { TelegramNotificationsService } from './telegram-notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [InquiriesController],
  providers: [TelegramNotificationsService],
})
export class InquiriesModule {}
