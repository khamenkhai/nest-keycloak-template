import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ApiSingleResponse,
} from 'src/common/decorators/api-response.decorator';
import { Resource, Scopes } from 'nest-keycloak-connect';
import { CategoriesService } from '../categories.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { FetchCategoriesDto } from '../dto/fetch-category.dto';
import { CategoryListItemDto, CategoryResponseDto } from '../dto/response.dto';

@ApiTags('Categories V2')
@ApiBearerAuth('Authorization')
@Resource('Categories')
@Controller()
export class CategoriesV2Controller {
  constructor(private readonly categoriesService: CategoriesService) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private withSlug(category: CategoryResponseDto) {
    return { ...category, slug: this.slugify(category.name) };
  }

  @Post()
  @Scopes('create')
  @ApiOperation({ summary: 'Create a new category (V2 - returns slug)' })
  @ApiSingleResponse(
    'Category created successfully',
    CategoryResponseDto,
    '/api/v2/categories',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  async create(@Body() dto: CreateCategoryDto) {
    const result = await this.categoriesService.create(dto);
    return { data: this.withSlug(result.data) };
  }

  @Get()
  @Scopes('read')
  @ApiOperation({ summary: 'Get all categories (V2 - returns slug)' })
  @ApiPaginatedResponse(
    'List of categories retrieved',
    CategoryListItemDto,
    '/api/v2/categories',
  )
  async findAll(@Query() query: FetchCategoriesDto) {
    const result = await this.categoriesService.findAll(query);
    return { ...result, data: result.data.map((c) => this.withSlug(c)) };
  }

  @Get(':id')
  @Scopes('read')
  @ApiOperation({ summary: 'Get category by ID (V2 - returns slug)' })
  @ApiSingleResponse(
    'Category details retrieved',
    CategoryResponseDto,
    '/api/v2/categories/1',
  )
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.categoriesService.findOne(id);
    return { data: this.withSlug(result.data) };
  }

  @Patch(':id')
  @Scopes('update')
  @ApiOperation({ summary: 'Update category (V2 - returns slug)' })
  @ApiSingleResponse(
    'Category updated successfully',
    CategoryResponseDto,
    '/api/v2/categories/1',
    HttpStatus.OK,
    'Resource updated successfully',
  )
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const result = await this.categoriesService.update(id, dto);
    return { data: this.withSlug(result.data) };
  }

  @Delete(':id')
  @Scopes('delete')
  @ApiOperation({ summary: 'Delete category (V2 - returns slug)' })
  @ApiSingleResponse(
    'Category deleted successfully',
    CategoryResponseDto,
    '/api/v2/categories/1',
    HttpStatus.OK,
    'Resource deleted successfully',
  )
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.categoriesService.remove(id);
    return { data: this.withSlug(result.data) };
  }
}
