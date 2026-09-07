import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const MOBILE_PLATFORMS = ['android', 'ios'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export class VersionCheckHeadersDto {
  @ApiProperty({
    description: 'Mobile platform',
    enum: MOBILE_PLATFORMS,
    example: 'android',
  })
  @IsIn(MOBILE_PLATFORMS)
  'x-client-platform': MobilePlatform;

  @ApiProperty({
    description: 'Semantic version of the mobile app',
    example: '2.4.1',
  })
  @IsString()
  @IsNotEmpty()
  'x-app-version': string;

  @ApiPropertyOptional({
    description: 'Native mobile build number',
    example: '2401001',
  })
  @IsString()
  @IsOptional()
  'x-app-build'?: string;
}

export class VersionCheckResponseDto {
  @ApiProperty({ enum: MOBILE_PLATFORMS, example: 'android' })
  platform: MobilePlatform;

  @ApiProperty({ example: '2.4.1' })
  currentVersion: string;

  @ApiProperty({ example: '2.6.0' })
  latestVersion: string;

  @ApiProperty({ example: '2.5.0' })
  minSupportedVersion: string;

  @ApiProperty({ example: true })
  updateRequired: boolean;

  @ApiProperty({ example: true })
  updateAvailable: boolean;

  @ApiPropertyOptional({
    example: 'https://play.google.com/store/apps/details?id=com.example.app',
  })
  updateUrl?: string;

  @ApiPropertyOptional({ example: 'Please update the app to continue.' })
  message?: string;
}
