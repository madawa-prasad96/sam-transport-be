import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class InviteCounterpartyDto {
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  country?: string;
}
