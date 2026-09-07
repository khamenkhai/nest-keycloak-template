import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateOtpRequestDto {
  @ApiProperty({
    description: 'Phone number used to generate OTP',
    example: '09999999999',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;
}

export class GenerateOtpResponseDto {
  @ApiProperty({
    description: 'Phone number that received the OTP',
    example: '+09999999999',
  })
  phone: string;

  @ApiProperty({
    description: 'Request id for the OTP',
    example: 'req-123-abc',
  })
  requestId: string;

  @ApiProperty({
    description: 'Generated OTP code',
    example: '123456',
  })
  otp: string;

  @ApiProperty({
    description: 'OTP expiration timestamp in ISO-8601 format',
    example: '2026-03-26T10:30:00.000Z',
  })
  otpExpiredAt: string;
}

export class MobileRefreshTokenRequestDto {
  @ApiProperty({
    description: 'Refresh token returned by mobile OTP verification',
    example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class VerifyOtpRequestDto {
  @ApiProperty({
    description: 'Phone number used for OTP verification',
    example: '09999999999',
  })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({
    description: 'OTP code to verify',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  otp: string;

  @ApiProperty({
    description: 'Unique device identifier',
    example: 'device-abc-123',
    required: false,
  })
  @IsString()
  deviceId?: string;

  @ApiProperty({
    description: 'Device IMEI',
    example: '356938035643809',
    required: false,
  })
  @IsString()
  deviceImei?: string;

  @ApiProperty({
    description: 'Human-readable device name',
    example: 'iPhone 15 Pro',
    required: false,
  })
  @IsString()
  deviceName?: string;

  @ApiProperty({
    description: 'Operating system of the client device',
    example: 'iOS',
    required: false,
  })
  @IsString()
  os?: string;

  @ApiProperty({
    description: 'Version of the mobile application',
    example: '2.4.1',
    required: false,
  })
  @IsString()
  appVersion?: string;
}

export class OtpUserDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 10 })
  organizationId: number;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  keycloakUserId: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: '09999999999' })
  phone: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;
}

export class VerifyOtpResponseDto {
  @ApiProperty({ example: '09999999999' })
  phone: string;

  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: string;

  @ApiProperty({ example: 3600 })
  expiresIn: number;

  @ApiProperty({ example: 7200 })
  refreshExpiresIn: number;

  @ApiPropertyOptional({ type: OtpUserDto })
  user?: OtpUserDto;
}
