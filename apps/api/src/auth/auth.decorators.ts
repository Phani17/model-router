import { SetMetadata } from '@nestjs/common';
import type { AppRole } from './auth.types.js';
export const PUBLIC_ROUTE = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: AppRole[]) => SetMetadata(REQUIRED_ROLES, roles);
