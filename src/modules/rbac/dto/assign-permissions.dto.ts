import { IsString, IsNotEmpty, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignPermissionsDto {
  @ApiProperty({
    description: 'The group name to assign permissions to',
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
    description: 'Array of scope names to assign',
    example: ['create', 'read', 'update', 'delete'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes: string[];
}
