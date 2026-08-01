import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { RecipientType } from '../../generated/prisma/enums';

export class AddRecipientDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(RecipientType, { message: 'Type must be CC or BCC' })
  type!: RecipientType;
}
