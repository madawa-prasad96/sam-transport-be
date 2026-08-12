import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  InquiryStatus,
  PackagingType,
  Priority,
  VehicleType,
  WeightUom,
} from '../../generated/prisma/enums';

/** A CC or BCC set at creation time, so the very first email already carries them. */
export class InquiryRecipientDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsIn(['CC', 'BCC'], { message: 'Type must be CC or BCC' })
  type!: 'CC' | 'BCC';
}

export class CreateInquiryDto {
  @IsUUID()
  providerUnitId!: string;

  /**
   * Copied recipients. They are attached while the inquiry is still a draft, so
   * nothing is sent until submission — and then the submission email includes
   * them, rather than them missing the one email that matters most.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => InquiryRecipientDto)
  recipients?: InquiryRecipientDto[];

  // Route
  @IsString() @IsNotEmpty() @MaxLength(500) pickupLocation!: string;
  @IsString() @IsNotEmpty() pickupContactName!: string;
  @IsString() @IsNotEmpty() pickupContactPhone!: string;
  @IsString() @IsNotEmpty() @MaxLength(500) deliveryLocation!: string;
  @IsString() @IsNotEmpty() deliveryContactName!: string;
  @IsString() @IsNotEmpty() deliveryContactPhone!: string;

  // Timing
  @IsDateString() readyByAt!: string;
  @IsDateString() requiredByAt!: string;

  // Cargo
  @IsString() @IsNotEmpty() @MaxLength(2000) cargoDescription!: string;
  @IsInt() @Min(1) @Type(() => Number) packageCount!: number;
  @IsNumber() @IsPositive() @Type(() => Number) grossWeight!: number;
  @IsOptional() @IsEnum(WeightUom) weightUom?: WeightUom;
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  volumeCbm?: number;
  @IsOptional() @IsString() dimensions?: string;
  @IsOptional() @IsEnum(PackagingType) packagingType?: PackagingType;

  // Vehicle & reference
  @IsOptional() @IsEnum(VehicleType) requestedVehicleType?: VehicleType;
  @IsOptional() @IsString() @MaxLength(120) referenceNumber?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() @MaxLength(2000) specialHandlingNotes?: string;
}

/** Same shape as create, minus the counterparty — that can never change. */
export class UpdateInquiryDto {
  @IsOptional() @IsString() @MaxLength(500) pickupLocation?: string;
  @IsOptional() @IsString() pickupContactName?: string;
  @IsOptional() @IsString() pickupContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(500) deliveryLocation?: string;
  @IsOptional() @IsString() deliveryContactName?: string;
  @IsOptional() @IsString() deliveryContactPhone?: string;
  @IsOptional() @IsDateString() readyByAt?: string;
  @IsOptional() @IsDateString() requiredByAt?: string;
  @IsOptional() @IsString() @MaxLength(2000) cargoDescription?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) packageCount?: number;
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  grossWeight?: number;
  @IsOptional() @IsEnum(WeightUom) weightUom?: WeightUom;
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  volumeCbm?: number;
  @IsOptional() @IsString() dimensions?: string;
  @IsOptional() @IsEnum(PackagingType) packagingType?: PackagingType;
  @IsOptional() @IsEnum(VehicleType) requestedVehicleType?: VehicleType;
  @IsOptional() @IsString() @MaxLength(120) referenceNumber?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() @MaxLength(2000) specialHandlingNotes?: string;
}

export class ProvideVehicleDto {
  @IsString() @IsNotEmpty() @MaxLength(60) vehicleNumber!: string;
  @IsEnum(VehicleType) vehicleType!: VehicleType;
  @IsOptional() @IsString() @MaxLength(200) transporterName?: string;
  @IsString() @IsNotEmpty() driverName!: string;
  @IsString() @IsNotEmpty() driverPhone!: string;
  @IsDateString() expectedPickupAt!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class DeclineInquiryDto {
  // Ten characters is enough to force something more useful than "no".
  @IsString()
  @MinLength(10, {
    message: 'Please give a reason of at least 10 characters',
  })
  @MaxLength(2000)
  reason!: string;
}

export class CreateCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(5000) body!: string;
}

export class ListInquiriesDto {
  @IsOptional() @IsEnum(InquiryStatus) status?: InquiryStatus;
  @IsOptional() @IsUUID() counterpartyId?: string;
  @IsOptional() @IsEnum(Priority) priority?: Priority;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsDateString() createdFrom?: string;
  @IsOptional() @IsDateString() createdTo?: string;
  /** "incoming" = addressed to us, "outgoing" = raised by us. */
  @IsOptional() @IsString() direction?: 'incoming' | 'outgoing';
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) pageSize?: number;
}
