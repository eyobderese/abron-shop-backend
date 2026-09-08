import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { CategoriesController } from './categories.controller';

@Module({ imports: [AuthModule, MediaModule], controllers: [CategoriesController] })
export class CategoriesModule {}
