import { PartialType } from '@nestjs/swagger';
import { CancelReason, DiscountType } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ValidatePromoDto {
  @IsString() @MaxLength(40) code: string;
  @IsUUID() product_id: string;
}

export class PromoVisitDto {
  @IsString() @MaxLength(40) code: string;
}

export class CreateMarketerDto {
  @IsString() @MinLength(2) @MaxLength(160) name: string;
  @IsString() @MaxLength(60) phone: string;
  @IsOptional() @IsString() @MaxLength(100) telegram?: string | null;
  @IsOptional() @IsString() @MaxLength(60) payout_method?: string | null;
  @IsOptional() @IsString() @MaxLength(120) payout_account?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdateMarketerDto extends PartialType(CreateMarketerDto) {}

export class CreatePromoCodeDto {
  @IsUUID() marketer_id: string;
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,30}$/, { message: 'Code must be 3-30 letters, numbers, - or _' })
  code: string;
  @IsEnum(DiscountType) discount_type: DiscountType;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount_value: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) commission_amount: number;
  @IsOptional() @IsDateString() starts_at?: string | null;
  @IsOptional() @IsDateString() ends_at?: string | null;
  @IsOptional() @IsInt() @Min(1) max_uses?: number | null;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

/** The code text and marketer are fixed once created. */
export class UpdatePromoCodeDto {
  @IsOptional() @IsEnum(DiscountType) discount_type?: DiscountType;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discount_value?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) commission_amount?: number;
  @IsOptional() @IsDateString() starts_at?: string | null;
  @IsOptional() @IsDateString() ends_at?: string | null;
  @IsOptional() @IsInt() @Min(1) max_uses?: number | null;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class ConfirmSaleDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) final_amount: number;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class CancelInquiryDto {
  @IsEnum(CancelReason) reason: CancelReason;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class CreatePayoutDto {
  @IsString() @MaxLength(60) method: string;
  @IsString() @MinLength(2) @MaxLength(120) transaction_ref: string;
  @IsOptional() @IsString() @MaxLength(2000) receipt_url?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
}

export class OpenDisputeDto {
  @IsUUID() inquiry_id: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}

export class ResolveDisputeDto {
  @IsIn(['accept', 'reject']) decision: 'accept' | 'reject';
  @IsString() @MinLength(3) @MaxLength(2000) admin_response: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) final_amount?: number;
}
