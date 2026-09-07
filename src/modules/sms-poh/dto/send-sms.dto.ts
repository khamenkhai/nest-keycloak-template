import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({
    example: '09123456789',
    description: 'The recipient phone number',
  })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({
    example: 'Hello World from NestJS!',
    description: 'The text body of your SMS message',
  })
  @IsString()
  @IsNotEmpty()
  message: string;
}
