import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { AdvertisementsController } from './advertisements.controller';

@Module({ imports: [AuthModule, MediaModule], controllers: [AdvertisementsController] })
export class AdvertisementsModule {}
