import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class ProductImageViewDto {
  @IsString() @MaxLength(2000) url: string;
  @IsString() @MaxLength(80) label: string;
}

export class CreateProductDto {
  @IsString() @MaxLength(240) name: string;
  @IsOptional() @IsString() @MaxLength(240) name_am?: string | null;
  @IsOptional() @IsString() @MaxLength(240) name_or?: string | null;
  @IsString() @MaxLength(20_000) description: string;
  @IsOptional() @IsString() @MaxLength(20_000) description_am?: string | null;
  @IsOptional() @IsString() @MaxLength(20_000) description_or?: string | null;
  @IsUUID() category_id: string;
  @IsOptional() @IsString() @MaxLength(160) brand?: string | null;
  @IsOptional() @IsNumber() @Min(0) price?: number | null;
  @IsOptional() @IsNumber() @Min(0) was_price?: number | null;
  @IsArray() images: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProductImageViewDto)
  image_views: ProductImageViewDto[];
  @IsBoolean() in_stock: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
