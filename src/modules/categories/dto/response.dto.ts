import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Technology' })
  name: string;

  @ApiPropertyOptional({ example: 'Tech related posts' })
  description?: string | null;
}

export class CategoryListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'Technology' })
  name: string;

  @ApiPropertyOptional({ example: 'Tech related posts' })
  description?: string | null;
}

export class CategoryPaginatedResponseDto {
  @ApiProperty({ type: [CategoryListItemDto] })
  data: CategoryListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 5 })
  lastPage: number;
}
