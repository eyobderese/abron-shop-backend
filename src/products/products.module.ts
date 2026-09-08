import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { ProductsController } from './products.controller';

@Module({ imports: [AuthModule, MediaModule], controllers: [ProductsController] })
export class ProductsModule {}
