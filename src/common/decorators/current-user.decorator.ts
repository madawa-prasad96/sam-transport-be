import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /// null only for SUPER_ADMIN, who belongs to no company.
  companyId: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);
