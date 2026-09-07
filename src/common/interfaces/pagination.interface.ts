import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional({
    description: 'Page number (starts from 1). Leave empty to get all items.',
  })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of items per page. Leave empty to get all items.',
  })
  limit?: number;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'desc' })
  sort?: 'asc' | 'desc';
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sort?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  lastPage: number;
}

export interface SingleResult<T> {
  data: T;
}

export interface CollectionResult<T> {
  data: T[];
}

export class PaginatedResponseDto<T> {
  data: T[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 5 })
  totalPages: number;

  @ApiProperty({ enum: ['asc', 'desc'], example: 'desc' })
  sort: 'asc' | 'desc';

  constructor(data: T[], meta: PaginationMeta) {
    this.data = data;
    this.total = meta.total;
    this.page = meta.page;
    this.limit = meta.limit;
    this.totalPages = meta.totalPages;
    this.sort = meta.sort || 'desc';
  }
}
