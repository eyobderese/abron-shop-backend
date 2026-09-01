import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { InquiryStatus } from '@prisma/client';

export class CreateInquiryDto {
  @IsUUID() product_id: string;
  @IsString() @MaxLength(160) full_name: string;
  @IsString() @MaxLength(60) phone: string;
  @IsString() @MaxLength(100) telegram: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string | null;
}

export class UpdateInquiryStatusDto {
  @IsEnum(InquiryStatus)
  status: InquiryStatus;
}
