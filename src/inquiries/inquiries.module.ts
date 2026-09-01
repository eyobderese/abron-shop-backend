import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InquiriesController } from './inquiries.controller';

@Module({ imports: [AuthModule], controllers: [InquiriesController] })
export class InquiriesModule {}
