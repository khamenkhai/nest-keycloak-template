import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SendSmsDto } from './dto/send-sms.dto';
import { RequestOtpDto, VerifyOtpDto } from './dto/otp-dto';

@Injectable()
export class SmsPohService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly senderId: string;
  private readonly baseUrl = 'https://v3.smspoh.com/api/rest/send';
  private readonly otpRequestUrl = 'https://v3.smspoh.com/api/otp/request';
  private readonly otpVerifyUrl = 'https://v3.smspoh.com/api/otp/verify';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService
      .getOrThrow<string>('SMSPOH_API_KEY')
      .trim();
    this.apiSecret = this.configService
      .getOrThrow<string>('SMSPOH_API_SECRET')
      .trim();
    this.senderId = this.configService
      .getOrThrow<string>('SMSPOH_SENDER_ID')
      .trim();
  }

  private getBearerToken(): string {
    const rawCredentials = `${this.apiKey}:${this.apiSecret}`;
    return Buffer.from(rawCredentials).toString('base64');
  }

  async sendSms(sendSmsDto: SendSmsDto) {
    this.validateCredentials();
    const base64Token = this.getBearerToken();
    const payload = { ...sendSmsDto, from: this.senderId };

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          Authorization: `Bearer ${base64Token}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'Failed to send SMS via SMSPoh');
    }
  }

  async requestOtp(requestOtpDto: RequestOtpDto) {
    this.validateCredentials();
    const base64Token = this.getBearerToken();

    try {
      const response = await axios.post(this.otpRequestUrl, null, {
        params: {
          from: this.senderId,
          to: requestOtpDto.to,
          brand: requestOtpDto.brand,
          accessToken: base64Token,
          pinLength: 6,
        },
      });
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'Failed to request OTP via SMSPoh');
    }
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    this.validateCredentials();
    const base64Token = this.getBearerToken();

    try {
      const response = await axios.post(this.otpVerifyUrl, null, {
        params: {
          requestId: verifyOtpDto.requestId,
          code: verifyOtpDto.code,
          accessToken: base64Token,
        },
      });

      return response.data;
    } catch (error: any) {
      this.handleError(error, 'OTP verification failed');
    }
  }

  private validateCredentials() {
    if (!this.apiKey || !this.apiSecret || !this.senderId) {
      throw new HttpException(
        'SMSPoh configurations are missing in the environment',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private handleError(error: any, defaultMessage: string) {
    const apiErrorMessage =
      error.response?.data?.message || error.response?.data;

    throw new HttpException(
      apiErrorMessage || defaultMessage,
      error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
