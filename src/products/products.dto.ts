import { PartialType } from '@nestjs/swagger';
import { ProductCurrency, ProductSizeType } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

export class ProductImageViewDto {
  @IsString() @MaxLength(2000) url: string;
  @IsString() @MaxLength(80) label: string;
}

export class CreateProductDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(240) name: string;
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
  @IsOptional() @IsNumber() @Min(0) price?: number | null;
  @IsOptional() @IsNumber() @Min(0) was_price?: number | null;
  @IsOptional() @IsEnum(ProductCurrency) currency?: ProductCurrency;
  @IsOptional() @IsEnum(ProductSizeType) size_type?: ProductSizeType;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(40, { each: true })
  sizes?: string[];
  @IsArray() images: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProductImageViewDto)
  image_views: ProductImageViewDto[];
  @IsBoolean() in_stock: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
