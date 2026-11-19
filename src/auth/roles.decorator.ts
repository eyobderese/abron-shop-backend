import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Roles with full access to the admin panel (the behaviour before roles were enforced). */
export const STAFF_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'SUPPORT'];

/**
 * Restricts an endpoint (or controller) to the given roles.
 * Endpoints without @Roles allow STAFF_ROLES only, so a new admin endpoint is
 * closed to limited roles (e.g. PRODUCT_EDITOR) unless it opts in explicitly.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Staff plus product editors: product list/create/edit, images, translations, categories (read). */
export const ProductEditorAllowed = () => Roles(...STAFF_ROLES, 'PRODUCT_EDITOR');
