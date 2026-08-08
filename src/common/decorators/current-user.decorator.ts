import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /// Every user belongs to a unit, ORG_ADMIN included.
  unitId: string;
}

/** ORG_ADMIN sees across all units; everyone else is scoped to their own. */
export const seesAllUnits = (user: AuthUser): boolean =>
  user.role === UserRole.ORG_ADMIN;

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
