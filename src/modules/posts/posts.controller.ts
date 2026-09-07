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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiPaginatedResponse,
  ApiSingleResponse,
} from 'src/common/decorators/api-response.decorator';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FetchPostsDto } from './dto/fetch-post.dto';
import { PostListItemDto, PostResponseDto } from './dto/response.dto';

@ApiTags('Posts')
@ApiBearerAuth('Authorization')
@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new post' })
  @ApiSingleResponse(
    'Post created successfully',
    PostResponseDto,
    '/api/v1/posts',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  create(@Body() dto: CreatePostDto) {
    // TODO: Get authorId from authenticated user
    return this.postsService.create(dto, 1);
  }

  @Get()
  @ApiOperation({ summary: 'Get all posts (Paginated)' })
  @ApiPaginatedResponse(
    'List of posts retrieved',
    PostListItemDto,
    '/api/v1/posts',
  )
  findAll(@Query() query: FetchPostsDto) {
    return this.postsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID' })
  @ApiSingleResponse(
    'Post details retrieved',
    PostResponseDto,
    '/api/v1/posts/1',
  )
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update post' })
  @ApiSingleResponse(
    'Post updated successfully',
    PostResponseDto,
    '/api/v1/posts/1',
    HttpStatus.OK,
    'Resource updated successfully',
  )
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePostDto,
  ) {
    return this.postsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete post' })
  @ApiSingleResponse(
    'Post deleted successfully',
    PostResponseDto,
    '/api/v1/posts/1',
    HttpStatus.OK,
    'Resource deleted successfully',
  )
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.postsService.remove(id);
  }
}
