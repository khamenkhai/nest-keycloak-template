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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FetchCategoriesDto } from './dto/fetch-category.dto';
import { CategoryListItemDto, CategoryResponseDto } from './dto/response.dto';

@ApiTags('Categories')
@ApiBearerAuth('Authorization')
@Resource('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Scopes('create')
  @ApiOperation({ summary: 'Create a new category' })
  @ApiSingleResponse(
    'Category created successfully',
    CategoryResponseDto,
    '/api/v1/categories',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Get()
  @Scopes('read')
  @ApiOperation({ summary: 'Get all categories (Paginated)' })
  @ApiPaginatedResponse(
    'List of categories retrieved',
    CategoryListItemDto,
    '/api/v1/categories',
  )
  findAll(@Query() query: FetchCategoriesDto) {
    return this.categoriesService.findAll(query);
  }

  @Get(':id')
  @Scopes('read')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiSingleResponse(
    'Category details retrieved',
    CategoryResponseDto,
    '/api/v1/categories/1',
  )
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  @Scopes('update')
  @ApiOperation({ summary: 'Update category' })
  @ApiSingleResponse(
    'Category updated successfully',
    CategoryResponseDto,
    '/api/v1/categories/1',
    HttpStatus.OK,
    'Resource updated successfully',
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @Scopes('delete')
  @ApiOperation({ summary: 'Delete category' })
  @ApiSingleResponse(
    'Category deleted successfully',
    CategoryResponseDto,
    '/api/v1/categories/1',
    HttpStatus.OK,
    'Resource deleted successfully',
  )
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.remove(id);
  }
}
