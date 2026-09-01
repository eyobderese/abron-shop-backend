import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdvertisementsController } from './advertisements.controller';

@Module({ imports: [AuthModule], controllers: [AdvertisementsController] })
export class AdvertisementsModule {}
