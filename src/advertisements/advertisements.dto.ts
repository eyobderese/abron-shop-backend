import { PartialType } from '@nestjs/swagger';
import { AdPlacement, MediaType } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAdvertisementDto {
  @IsString() @MaxLength(240) title: string;
  @IsString() @MaxLength(2000) media_url: string;
  @IsEnum(MediaType) media_type: MediaType;
  @IsOptional() @IsString() @MaxLength(2000) poster_url?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) link_url?: string | null;
  @IsEnum(AdPlacement) placement: AdPlacement;
  @IsOptional() @IsUUID() category_id?: string | null;
  @IsOptional() @IsInt() sort_order?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsDateString() starts_at?: string | null;
  @IsOptional() @IsDateString() ends_at?: string | null;
}

export class UpdateAdvertisementDto extends PartialType(CreateAdvertisementDto) {}
