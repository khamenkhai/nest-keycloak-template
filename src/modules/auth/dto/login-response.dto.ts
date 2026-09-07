import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
  @ApiProperty({
    description: 'User ID from Keycloak',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'User email',
    example: 'admin@example.com',
  })
  email: string;

  @ApiProperty({
    description: 'User name',
    example: 'John Doe',
  })
  name: string;

  @ApiProperty({
    description: 'Username',
    example: 'admin@example.com',
  })
  username: string;

  @ApiProperty({
    description: 'User enabled status',
    example: true,
  })
  enabled: boolean;

  @ApiProperty({
    description: 'Subject identifier from JWT token',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  sub?: string;

  @ApiProperty({
    description: 'Preferred username from JWT token',
    example: 'admin@example.com',
    required: false,
  })
  preferredUsername?: string;

  @ApiProperty({
    description: 'Given name from JWT token',
    example: 'John',
    required: false,
  })
  givenName?: string;

  @ApiProperty({
    description: 'Family name from JWT token',
    example: 'Doe',
    required: false,
  })
  familyName?: string;

  @ApiProperty({
    description: 'Email verification status from JWT token',
    example: true,
    required: false,
  })
  emailVerified?: boolean;
}

export class LoginDataDto {
  @ApiProperty({
    description: 'User information',
    type: UserDto,
  })
  user: UserDto;

  @ApiProperty({
    description: 'Access token',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Token type',
    example: 'Bearer',
  })
  tokenType: string;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 3600,
  })
  expiresIn: number;
}

export class LoginResponseDto {
  @ApiProperty({
    description: 'User information',
    type: UserDto,
  })
  user: UserDto;

  @ApiProperty({
    description: 'Access token from Keycloak',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Refresh token from Keycloak',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;

  @ApiProperty({
    description: 'Token type',
    example: 'Bearer',
  })
  tokenType: string;

  @ApiProperty({
    description: 'Access token expiration time in seconds',
    example: 3600,
  })
  expiresIn: number;

  @ApiProperty({
    description: 'Refresh token expiration time in seconds',
    example: 1800,
  })
  refreshExpiresIn: number;
}
