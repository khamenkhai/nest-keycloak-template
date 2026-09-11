import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'nest-keycloak-connect';
import { AuthService } from './auth.service';
import {
  AssignGroupDto,
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RegisterDto,
} from './dto';
import { ApiSingleResponse } from 'src/common/decorators/api-response.decorator';

@Controller('')
@ApiTags('Admin Auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiSingleResponse(
    'Registration successful',
    LoginResponseDto,
    '/admin/v1/auth/register',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Email already registered',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request',
  })
  @Public()
  async register(@Body() registerDto: RegisterDto) {
    return await this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Admin login with email and password' })
  @ApiSingleResponse(
    'Login successful',
    LoginResponseDto,
    '/admin/v1/auth/login',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid credentials',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request',
  })
  @Public()
  async login(@Body() loginDto: LoginDto) {
    return await this.authService.login(loginDto);
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiSingleResponse(
    'Token refreshed successfully',
    LoginResponseDto,
    '/admin/v1/auth/refresh-token',
    HttpStatus.CREATED,
    'Resource created successfully',
  )
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid refresh token',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request',
  })
  @Public()
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return await this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Post('assign-group')
  @ApiOperation({ summary: 'Assign a user to a Keycloak group' })
  @ApiSingleResponse(
    'User assigned to group successfully',
    {
      type: 'object',
      properties: { success: { type: 'boolean' }, message: { type: 'string' } },
    },
    '/admin/v1/auth/assign-group',
    HttpStatus.OK,
    'User assigned to group successfully',
  )
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User or group not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Bad request',
  })
  async assignGroup(@Body() assignGroupDto: AssignGroupDto) {
    return await this.authService.assignToGroup(assignGroupDto);
  }
}
