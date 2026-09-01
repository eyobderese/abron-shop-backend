import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsOptional() @IsUUID() parent_id?: string | null;
  @IsString() @MaxLength(120) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string;
  @IsString() @MaxLength(160) name_en: string;
  @IsOptional() @IsString() @MaxLength(160) name_am?: string | null;
  @IsOptional() @IsString() @MaxLength(160) name_or?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) image_url?: string | null;
  @IsOptional() @IsInt() sort_order?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
