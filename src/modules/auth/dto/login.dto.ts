import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'System user email address',
    example: 'mgmg@gmail.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    description: 'System User password',
    example: 'password123',
    minLength: 6,
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @ApiProperty({
    description:
      'reCAPTCHA v3 token. Use "test-recaptcha-token-for-swagger" for testing when RECAPTCHA_SECRET_KEY is not configured',
    example: 'test-recaptcha-token-for-swagger',
    default: 'test-recaptcha-token-for-swagger',
  })
  @IsString({ message: 'reCAPTCHA token must be a string' })
  @IsNotEmpty({ message: 'reCAPTCHA token is required' })
  recaptchaToken: string;
}
