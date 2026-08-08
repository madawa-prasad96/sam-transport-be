import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UnitStatus, WeightUom } from '../../generated/prisma/enums';

export class CreateUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Code may contain letters, numbers, hyphens and underscores only',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  registrationNumber?: string;

  @IsString()
  @IsNotEmpty()
  addressLine!: string;

  @IsString()
  @IsNotEmpty()
  country!: string;

  @IsString()
  @IsNotEmpty()
  primaryContactName!: string;

  @IsEmail()
  primaryContactEmail!: string;

  @IsString()
  @IsNotEmpty()
  primaryContactPhone!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(WeightUom)
  defaultWeightUom?: WeightUom;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  primaryContactName?: string;

  @IsOptional()
  @IsEmail()
  primaryContactEmail?: string;

  @IsOptional()
  @IsString()
  primaryContactPhone?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(WeightUom)
  defaultWeightUom?: WeightUom;
}

export class SetUnitStatusDto {
  @IsEnum(UnitStatus)
  status!: UnitStatus;
}
