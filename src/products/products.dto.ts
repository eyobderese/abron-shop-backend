import { PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

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
  @IsArray() image_views: Array<{ url: string; label: string }>;
  @IsBoolean() in_stock: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
