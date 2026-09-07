import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'nest-keycloak-connect';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, RefreshTokenDto, RegisterDto } from './dto';
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
}
