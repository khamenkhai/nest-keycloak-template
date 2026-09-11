import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RemovePermissionsDto {
  @ApiProperty({
    description: 'The group name to remove permissions from',
    example: 'admin-group',
    enum: ['admin-group', 'user-group'],
  })
  @IsString()
  @IsNotEmpty()
  groupName: string;

  @ApiProperty({
    description: 'The resource name',
    example: 'Posts',
  })
  @IsString()
  @IsNotEmpty()
  resourceName: string;

  @ApiProperty({
    description: 'Array of scope names to remove',
    example: ['delete'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes: string[];
}
