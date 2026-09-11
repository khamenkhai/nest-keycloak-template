import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetGroupPermissionsDto {
  @ApiProperty({
    description: 'The group name to get permissions for',
    example: 'admin-group',
    enum: ['admin-group', 'user-group'],
  })
  @IsString()
  @IsNotEmpty()
  groupName: string;
}
