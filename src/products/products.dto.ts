import { OmitType, PartialType } from '@nestjs/swagger';
import { ProductCurrency, ProductSizeType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';

export class ProductImageViewDto {
  @IsString() @MaxLength(2000) url: string;
  @IsString() @MaxLength(80) label: string;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(240) name: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(120) product_type: string;
  @IsOptional() @IsString() @MaxLength(240) name_am?: string | null;
  @IsOptional() @IsString() @MaxLength(240) name_or?: string | null;
  @IsString() @MaxLength(20_000) description: string;
  @IsOptional() @IsString() @MaxLength(20_000) description_am?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) description_or?: string | null;
  @IsUUID() category_id: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(160) brand: string;
  @IsOptional() @IsString() @MaxLength(80) model_code?: string | null;
  @IsOptional() @IsString() @MaxLength(240) family_name?: string | null;
  @IsOptional() @IsString() @MaxLength(80) color_name?: string | null;
  @IsOptional() @IsString() @MaxLength(40) color_code?: string | null;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) color_hex?: string | null;
  @IsOptional() @IsInt() @Min(0) variant_sort_order?: number;
  /** Every product must have a price (customers see it and promo discounts use it). */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Price is required' })
  @IsPositive({ message: 'Price must be greater than 0' })
  price: number;
  @IsOptional() @IsNumber() @Min(0) was_price?: number | null;
  /** Flash deal: send null for all three to remove the deal. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive({ message: 'Flash deal price must be greater than 0' })
  flash_price?: number | null;
  @IsOptional() @IsDateString() flash_starts_at?: string | null;
  @IsOptional() @IsDateString() flash_ends_at?: string | null;
  @IsOptional() @IsEnum(ProductCurrency) currency?: ProductCurrency;
  @IsOptional() @IsEnum(ProductSizeType) size_type?: ProductSizeType;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(40, { each: true })
  sizes?: string[];
  @IsArray() images: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProductImageViewDto)
  image_views: ProductImageViewDto[];
  @IsBoolean() in_stock: boolean;
}

export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['price'] as const)) {
  /** Optional when editing other fields, but it can never be cleared or set to 0. */
  @ValidateIf((_, value) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Price is required' })
  @IsPositive({ message: 'Price must be greater than 0' })
  price?: number;
}
