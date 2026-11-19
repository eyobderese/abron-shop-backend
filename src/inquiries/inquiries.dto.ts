import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateInquiryDto {
  @IsUUID() product_id: string;
  @IsString() @MaxLength(160) full_name: string;
  @IsString() @MaxLength(60) phone: string;
  @IsString() @MaxLength(100) telegram: string;
  @IsOptional() @IsString() @MaxLength(40) selected_size?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) message?: string | null;
  @IsOptional() @IsString() @MaxLength(40) promo_code?: string | null;
}

/** An order taken by phone / in person, recorded by the admin so it is never "off the books". */
export class CreateAdminInquiryDto {
  @IsUUID() product_id: string;
  @IsString() @MaxLength(160) full_name: string;
  @IsString() @MaxLength(60) phone: string;
  @IsOptional() @IsString() @MaxLength(100) telegram?: string | null;
  @IsOptional() @IsString() @MaxLength(40) selected_size?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) message?: string | null;
  @IsOptional() @IsString() @MaxLength(40) promo_code?: string | null;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
}

/** Only the early, non-financial statuses can be set directly. */
export class UpdateInquiryStatusDto {
  @IsIn(['new', 'contacted'])
  status: 'new' | 'contacted';
}

export class CreateFeedbackDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
  @IsOptional() @IsBoolean() allow_public?: boolean;
}
