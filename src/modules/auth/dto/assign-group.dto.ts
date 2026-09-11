import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignGroupDto {
  @ApiProperty({
    description: 'The Keycloak user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'The group name to assign the user to',
    example: 'admin-group',
    enum: ['admin-group', 'user-group'],
  })
  @IsString()
  @IsNotEmpty()
  groupName: string;
}
