import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  password!: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  newPassword!: string;
}
