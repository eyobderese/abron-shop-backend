import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Roles an admin can assign from the Team page. */
export const ASSIGNABLE_ROLES = ['ADMIN', 'PRODUCT_EDITOR'] as const satisfies readonly UserRole[];

export class CreateUserDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
  @IsIn(ASSIGNABLE_ROLES) role: (typeof ASSIGNABLE_ROLES)[number];
}

export class UpdateUserDto {
  @IsOptional() @IsIn(ASSIGNABLE_ROLES) role?: (typeof ASSIGNABLE_ROLES)[number];
  @IsOptional() @IsBoolean() is_active?: boolean;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
}
