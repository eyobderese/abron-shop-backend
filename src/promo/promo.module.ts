import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromoAdminController, PromoPublicController } from './promo.controller';
import { PromoService } from './promo.service';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  imports: [AuthModule],
  controllers: [PromoPublicController, PromoAdminController],
  providers: [PromoService, TelegramBotService],
  exports: [PromoService],
})
export class PromoModule {}
