import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PostStatus } from 'src/database/generated/client/client';
import { PrismaService } from 'src/database/prisma/prisma.service';
import {
  PaginatedResult,
  SingleResult,
} from 'src/common/interfaces/pagination.interface';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FetchPostsDto } from './dto/fetch-post.dto';
import { PostListItemDto, PostResponseDto } from './dto/response.dto';

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly selectWithRelations = {
    id: true,
    title: true,
    content: true,
    status: true,
    authorId: true,
    categoryId: true,
    author: { select: { id: true, name: true, email: true } },
    category: { select: { id: true, name: true, description: true } },
  } as const;

  async create(dto: CreatePostDto, authorId: number): Promise<SingleResult<PostResponseDto>> {
    try {
      const data = await this.prisma.post.create({
        data: {
          title: dto.title,
          content: dto.content,
          status: (dto.status as PostStatus) || PostStatus.DRAFT,
          authorId,
          categoryId: dto.categoryId,
        },
        select: this.selectWithRelations,
      });

      return { data: data as PostResponseDto };
    } catch (error) {
      throw new InternalServerErrorException(
        `An unexpected error occurred while creating the post: ${error.message}`,
      );
    }
  }

  async findAll(
    query: FetchPostsDto,
  ): Promise<PaginatedResult<PostListItemDto>> {
    const { page = 1, limit = 10, status, categoryId, search, sortBy, sortOrder } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PostWhereInput = { isDeleted: false };
    if (status) where.status = status as PostStatus;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = sortBy
      ? { [sortBy]: sortOrder ?? 'desc' }
      : { createdAt: 'desc' };

    const [total, data] = await Promise.all([
      this.prisma.post.count({ where }),
      this.prisma.post.findMany({
        where,
        skip,
        take: limit,
        select: this.selectWithRelations,
        orderBy,
      }),
    ]);

    return {
      data: data as PostListItemDto[],
      total,
      page,
      lastPage: Math.ceil(total / limit),
    };
  }

  async findOne(id: number): Promise<SingleResult<PostResponseDto>> {
    const data = await this.prisma.post.findFirst({
      where: { id, isDeleted: false },
      select: this.selectWithRelations,
    });

    if (!data) throw new NotFoundException(`Post #${id} not found`);

    return { data: data as PostResponseDto };
  }

  async update(
    id: number,
    dto: UpdatePostDto,
  ): Promise<SingleResult<PostResponseDto>> {
    try {
      const existing = await this.prisma.post.findFirst({
        where: { id, isDeleted: false },
      });
      if (!existing) throw new NotFoundException(`Post #${id} not found`);

      const data = await this.prisma.post.update({
        where: { id },
        data: {
          title: dto.title,
          content: dto.content,
          status: dto.status ? (dto.status as PostStatus) : undefined,
          categoryId: dto.categoryId,
        },
        select: this.selectWithRelations,
      });

      return { data: data as PostResponseDto };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(
        `An unexpected error occurred while updating the post: ${error.message}`,
      );
    }
  }

  async remove(id: number): Promise<SingleResult<PostResponseDto>> {
    const existing = await this.prisma.post.findFirst({
      where: { id, isDeleted: false },
    });
    if (!existing) throw new NotFoundException(`Post #${id} not found`);

    const data = await this.prisma.post.update({
      where: { id },
      data: { isDeleted: true },
      select: this.selectWithRelations,
    });

    return { data: data as PostResponseDto };
  }
}
