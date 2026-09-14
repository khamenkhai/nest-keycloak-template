import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty({ description: 'User ID', example: 1 })
  id: number;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  name: string;

  @ApiProperty({ description: 'User email', example: 'john@example.com' })
  email: string;

  @ApiProperty({
    description: 'User role',
    example: 'USER',
    enum: ['ADMIN', 'USER'],
  })
  role: string;

  @ApiProperty({ description: 'Account active status', example: true })
  status: boolean;

  @ApiProperty({
    description: 'Keycloak user ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
  })
  keycloakUserId?: string | null;

  @ApiProperty({
    description: 'Account creation date',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last update date',
    example: '2026-01-01T00:00:00.000Z',
    required: false,
  })
  updatedAt: Date | null;
}
