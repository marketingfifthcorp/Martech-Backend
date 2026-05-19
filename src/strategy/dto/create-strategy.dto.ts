import { IsString, IsOptional, IsArray } from 'class-validator';

export class GenerateStrategyDto {
  @IsString()
  briefId: string;
}

export class UpdateStrategyDto {
  @IsOptional() @IsString()
  summary?: string;

  @IsOptional() @IsArray()
  contentPillars?: any[];

  @IsOptional()
  targetAudience?: any;

  @IsOptional() @IsString()
  messagingDirection?: string;

  @IsOptional() @IsString()
  toneRecommendation?: string;

  @IsOptional()
  platformStrategy?: any;

  @IsOptional() @IsArray()
  keyMessages?: string[];
}
