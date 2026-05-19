import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

export class UpdatePostDto {
  @IsOptional() @IsDateString() scheduledDate?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() format?: string;
  @IsOptional() @IsString() objective?: string;
  @IsOptional() @IsString() topic?: string;
  @IsOptional() @IsString() hook?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) hashtags?: string[];
  @IsOptional() @IsString() cta?: string;
  @IsOptional() @IsString() creativeNote?: string;
  @IsOptional() @IsString() status?: string;
}
