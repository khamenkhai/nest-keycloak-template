import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryResponseDto } from 'src/modules/categories/dto/response.dto';

export class PostAuthorDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  email?: string | null;
}

export class PostResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'My First Post' })
  title: string;

  @ApiPropertyOptional({ example: 'This is the content...' })
  content?: string | null;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], example: 'DRAFT' })
  status: string;

  @ApiProperty({ example: 1 })
  authorId: number;

  @ApiPropertyOptional({ example: 1 })
  categoryId?: number | null;

  @ApiPropertyOptional({ type: PostAuthorDto })
  author?: PostAuthorDto;

  @ApiPropertyOptional({ type: CategoryResponseDto })
  category?: CategoryResponseDto;
}

export class PostListItemDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'My First Post' })
  title: string;

  @ApiPropertyOptional({ example: 'This is the content...' })
  content?: string | null;

  @ApiProperty({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], example: 'DRAFT' })
  status: string;

  @ApiProperty({ example: 1 })
  authorId: number;

  @ApiPropertyOptional({ example: 1 })
  categoryId?: number | null;

  @ApiPropertyOptional({ type: PostAuthorDto })
  author?: PostAuthorDto;

  @ApiPropertyOptional({ type: CategoryResponseDto })
  category?: CategoryResponseDto;
}

export class PostPaginatedResponseDto {
  @ApiProperty({ type: [PostListItemDto] })
  data: PostListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 5 })
  lastPage: number;
}
