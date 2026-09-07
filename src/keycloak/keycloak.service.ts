import KcAdminClient from '@keycloak/keycloak-admin-client';
import { GrantTypes } from '@keycloak/keycloak-admin-client/lib/utils/auth';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class KeycloakService implements OnModuleInit {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly serviceUserPassword: string;
  private kcAdminClient: KcAdminClient;
  private readonly baseUrl: string;
  private readonly realmName: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly grantType: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService
      .getOrThrow<string>('KEYCLOAK_BASE_URL')
      .replace(/\/$/, '');
    this.realmName = this.configService.getOrThrow<string>(
      'KEYCLOAK_REALM_NAME',
    );
    this.clientId = this.configService.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>(
      'KEYCLOAK_CLIENT_SECRET',
    );
    this.grantType = this.configService.getOrThrow<string>(
      'KEYCLOAK_GRANT_TYPE',
    );
    this.serviceUserPassword =
      this.configService.get<string>('KEYCLOAK_SERVICE_USER_PASSWORD') ??
      'SecurePass123!';

    this.kcAdminClient = new KcAdminClient({
      baseUrl: this.baseUrl,
      realmName: this.realmName,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Keycloak is not configured — skipping connection check',
      );
      return;
    }
    try {
      await this.authenticate();
      this.logger.log('Keycloak connected successfully');
    } catch {
      this.logger.error('Keycloak connection failed — service is unavailable');
    }
  }

  async authenticate(): Promise<void> {
    try {
      await this.kcAdminClient.auth({
        grantType: this.grantType as GrantTypes,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        // Request necessary scopes for admin operations
        scopes: ['openid', 'profile', 'email'],
      });

      this.logger.log('Keycloak authentication successful');
    } catch (error) {
      const detail =
        error instanceof Error
          ? (error as any).response?.data
            ? JSON.stringify((error as any).response.data)
            : error.message
          : String(error);
      this.logger.error(`Keycloak authentication failed: ${detail}`);
      throw new Error(`Keycloak authentication failed: ${detail}`);
    }
  }

  getClient(): KcAdminClient {
    return this.kcAdminClient;
  }

  isConfigured(): boolean {
    // Check if all required configuration is present
    return !!(
      this.baseUrl &&
      this.realmName &&
      this.clientId &&
      this.clientSecret &&
      this.grantType
    );
  }

  getConfigurationInfo(): object {
    return {
      baseUrl: this.baseUrl,
      realmName: this.realmName,
      clientId: this.clientId,
      grantType: this.grantType,
      hasClientSecret: !!this.clientSecret,
      isConfigured: this.isConfigured(),
    };
  }

  getServiceUserPassword(): string {
    return this.serviceUserPassword;
  }

  /**
   * Authenticate user with username/password and get access token
   */
  async authenticateUser(
    username: string,
    password: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
    refreshExpiresIn: number;
  }> {
    try {
      const tokenUrl = `${this.baseUrl}/realms/${this.realmName}/protocol/openid-connect/token`;

      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'password',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          username,
          password,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const tokenData = response.data;

      this.logger.log('User authentication successful', {
        username,
        expiresIn: tokenData.expires_in,
      });

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in,
        refreshExpiresIn: tokenData.refresh_expires_in,
      };
    } catch (error) {
      this.logger.error('User authentication failed', {
        error: error.response?.data || error.message,
        username,
      });
      throw new Error(
        `User authentication failed: ${error.response?.data?.error_description || error.message}`,
      );
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
    refreshExpiresIn: number;
  }> {
    try {
      const tokenUrl = `${this.baseUrl}/realms/${this.realmName}/protocol/openid-connect/token`;

      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const tokenData = response.data;

      this.logger.log('Token refresh successful');

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type,
        expiresIn: tokenData.expires_in,
        refreshExpiresIn: tokenData.refresh_expires_in,
      };
    } catch (error) {
      this.logger.error('Token refresh failed', {
        error: error.response?.data || error.message,
      });
      throw new Error(
        `Token refresh failed: ${error.response?.data?.error_description || error.message}`,
      );
    }
  }

  /**
   * Revoke a user session by invalidating the given refresh token.
   */
  async logout(refreshToken: string): Promise<void> {
    const logoutUrl = `${this.baseUrl}/realms/${this.realmName}/protocol/openid-connect/logout`;

    await axios.post(
      logoutUrl,
      new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    this.logger.log('User logout successful');
  }
}
