import { IsString, MaxLength, MinLength } from 'class-validator';

export class ProductTranslationDraftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  description: string;
}
