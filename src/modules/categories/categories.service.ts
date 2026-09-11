import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import {
  PaginatedResult,
  SingleResult,
} from 'src/common/interfaces/pagination.interface';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { FetchCategoriesDto } from './dto/fetch-category.dto';
import { CategoryListItemDto, CategoryResponseDto } from './dto/response.dto';
import { Prisma } from 'src/database/generated/client/client';

const categorySelect = {
  id: true,
  name: true,
  description: true,
} satisfies Prisma.CategorySelect;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly baseSelect = categorySelect;

  async create(
    dto: CreateCategoryDto,
  ): Promise<SingleResult<CategoryResponseDto>> {
    try {
      const data = await this.prisma.category.create({
        data: {
          name: dto.name,
          description: dto.description,
        },
        select: this.baseSelect,
      });

      return { data };
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Category name already exists.');
      }
      throw new InternalServerErrorException(
        `An unexpected error occurred while creating the category: ${error.message}`,
      );
    }
  }

  async findAll(
    query: FetchCategoriesDto,
  ): Promise<PaginatedResult<CategoryListItemDto>> {
    const { page = 1, limit = 10, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false };
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const orderBy: any = sortBy
      ? { [sortBy]: sortOrder ?? 'asc' }
      : { createdAt: 'asc' };

    const [total, data] = await Promise.all([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        skip,
        take: limit,
        select: this.baseSelect,
        orderBy,
      }),
    ]);

    return {
      data: data,
      total,
      page,
      lastPage: Math.ceil(total / limit),
    };
  }

  async findOne(id: number): Promise<SingleResult<CategoryResponseDto>> {
    const data = await this.prisma.category.findFirst({
      where: { id, isDeleted: false },
      select: this.baseSelect,
    });

    if (!data) throw new NotFoundException(`Category #${id} not found`);

    return { data: data };
  }

  async update(
    id: number,
    dto: UpdateCategoryDto,
  ): Promise<SingleResult<CategoryResponseDto>> {
    try {
      const existing = await this.prisma.category.findFirst({
        where: { id, isDeleted: false },
      });
      if (!existing) throw new NotFoundException(`Category #${id} not found`);

      const data = await this.prisma.category.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
        },
        select: this.baseSelect,
      });

      return { data };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (error?.code === 'P2002') {
        throw new BadRequestException('Category name already exists.');
      }
      throw new InternalServerErrorException(
        `An unexpected error occurred while updating the category: ${error.message}`,
      );
    }
  }

  async remove(id: number): Promise<SingleResult<CategoryResponseDto>> {
    const existing = await this.prisma.category.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) throw new NotFoundException(`Category #${id} not found`);

    const data = await this.prisma.category.update({
      where: { id },
      data: { isDeleted: true },
      select: this.baseSelect,
    });

    return { data: data };
  }
}
