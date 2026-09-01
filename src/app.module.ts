import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { InquiriesModule } from './inquiries/inquiries.module';
import { AdvertisementsModule } from './advertisements/advertisements.module';
import { MediaModule } from './media/media.module';
import { HealthController } from './health/health.controller';

function validate(config: Record<string, unknown>) {
  const required = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MEDIA_PUBLIC_URL'];
  for (const key of required) {
    if (!config[key]) throw new Error(`Missing required environment variable: ${key}`);
  }
  if (String(config.JWT_ACCESS_SECRET).length < 32 || String(config.JWT_REFRESH_SECRET).length < 32) {
    throw new Error('JWT secrets must each contain at least 32 characters');
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    AuthModule,
    CategoriesModule,
    ProductsModule,
    InquiriesModule,
    AdvertisementsModule,
    MediaModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
