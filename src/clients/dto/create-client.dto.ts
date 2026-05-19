import { IsString, IsEmail, IsOptional, IsArray, IsInt, IsDateString, Min, Max } from 'class-validator';

export class CreateClientDto {
  @IsString()
  name: string;

  @IsOptional() @IsString()
  brand?: string;

  @IsOptional() @IsString()
  industry?: string;

  @IsArray() @IsString({ each: true })
  platforms: string[];

  @IsOptional() @IsString()
  package?: string;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  postingFrequency?: number;

  @IsOptional() @IsString()
  contactName?: string;

  @IsOptional() @IsEmail()
  contactEmail?: string;

  @IsOptional() @IsString()
  contactPhone?: string;

  @IsOptional() @IsString()
  websiteUrl?: string;

  @IsOptional() @IsString()
  logoUrl?: string;

  @IsOptional() @IsDateString()
  deadline?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  clientUserId?: string; // link to existing client portal user
}
