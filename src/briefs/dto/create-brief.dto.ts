import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateBriefDto {
  @IsString()
  clientId: string;

  @IsOptional() @IsString()
  websiteUrl?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  socialLinks?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  referenceUrls?: string[];

  @IsOptional() @IsString()
  adminNotes?: string;

  @IsOptional() @IsString()
  targetAudience?: string;

  @IsOptional() @IsString()
  competitorNotes?: string;

  @IsOptional() @IsString()
  campaignGoals?: string;

  @IsOptional() @IsString()
  toneOfVoice?: string;

  @IsOptional() @IsString()
  sector?: string;

  @IsOptional() @IsString()
  budgetRange?: string;
}
