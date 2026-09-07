import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePostDto {
  @ApiPropertyOptional({ example: 'My First Post' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'This is the content of my post...' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  categoryId?: number;
}
