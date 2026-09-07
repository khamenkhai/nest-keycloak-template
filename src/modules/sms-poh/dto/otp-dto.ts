import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '09123456789' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({ example: 'MyCompany', description: 'Your brand name' })
  @IsString()
  @IsNotEmpty()
  brand: string;
}

export class VerifyOtpDto {
  @ApiProperty({
    example: 'v-12345-abcde',
    description: 'The requestId from the request step',
  })
  @IsString()
  @IsNotEmpty()
  requestId: string;

  @ApiProperty({
    example: '123456',
    description: 'The OTP code submitted by the user',
  })
  @IsString()
  @IsNotEmpty()
  code: string;
}
