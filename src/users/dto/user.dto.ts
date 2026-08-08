import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { NotificationPreference, UserRole } from '../../generated/prisma/enums';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(UserRole, {
    message: 'Role must be ORG_ADMIN, UNIT_ADMIN or UNIT_USER',
  })
  role!: UserRole;

  /** Org admin only. Defaults to the inviter's own unit. */
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}

export class MoveUserDto {
  @IsUUID()
  unitId!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEnum(NotificationPreference)
  notificationPreference?: NotificationPreference;
}
