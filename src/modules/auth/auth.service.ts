import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma/prisma.service';
import { KeycloakService } from 'src/keycloak';
import { AssignGroupDto, LoginDto, LoginResponseDto, RegisterDto } from './dto';
import { extractEmailFromToken } from 'src/common/utils/jwt.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly keycloakService: KeycloakService,
  ) {}

  async register(registerDto: RegisterDto): Promise<LoginResponseDto> {
    try {
      this.logger.debug('User registration attempt', {
        email: registerDto.email,
      });

      if (!this.keycloakService.isConfigured()) {
        this.logger.error('Keycloak is not configured');
        throw new UnauthorizedException('Authentication service not available');
      }

      const existingUser = await this.prismaService.user.findUnique({
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already registered');
      }

      await this.keycloakService.authenticate();
      const keycloakClient = this.keycloakService.getClient();

      let kcUser;
      try {
        kcUser = await keycloakClient.users.create({
          realm: process.env.KEYCLOAK_REALM_NAME,
          username: registerDto.email,
          email: registerDto.email,
          emailVerified: true,
          enabled: true,
          credentials: [
            {
              type: 'password',
              value: registerDto.password,
              temporary: false,
            },
          ],
        });

        await keycloakClient.users.update(
          { id: kcUser.id, realm: process.env.KEYCLOAK_REALM_NAME },
          {
            emailVerified: true,
            enabled: true,
            requiredActions: [],
          },
        );
      } catch (kcError) {
        this.logger.error('Keycloak user creation failed', {
          error: kcError.message,
          response: kcError.response?.data || kcError.response || null,
          email: registerDto.email,
        });
        throw new UnauthorizedException(
          `Keycloak user creation failed: ${JSON.stringify(kcError.response?.data || kcError.message)}`,
        );
      }

      // Assign new user to 'user' group (read-only by default)
      try {
        await this.keycloakService.addUserToGroup(kcUser.id, 'user-group');
      } catch (groupError) {
        this.logger.warn('Failed to assign user to group', {
          error: groupError.message,
          email: registerDto.email,
        });
      }

      const user = await this.prismaService.user.create({
        data: {
          keycloakUserId: kcUser.id,
          name: registerDto.name,
          email: registerDto.email,
          password: 'keycloak-managed',
          role: registerDto.role || 'USER',
        },
      });

      this.logger.log('User registered successfully', {
        email: registerDto.email,
      });

      const tokenData = await this.keycloakService.authenticateUser(
        registerDto.email,
        registerDto.password,
      );

      return {
        user: {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          username: user.email,
          enabled: user.status,
        },
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        tokenType: tokenData.tokenType,
        expiresIn: tokenData.expiresIn,
        refreshExpiresIn: tokenData.refreshExpiresIn,
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      this.logger.error('User registration failed', {
        error: error.message || String(error),
        response: error.response?.data || error.response || null,
        email: registerDto.email,
      });
      throw new UnauthorizedException(
        `Registration failed: ${error.message || String(error)}`,
      );
    }
  }

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    try {
      this.logger.debug('User login attempt', { email: loginDto.email });

      if (!this.keycloakService.isConfigured()) {
        this.logger.error('Keycloak is not configured');
        throw new UnauthorizedException('Authentication service not available');
      }

      const user = await this.prismaService.user.findUnique({
        where: { email: loginDto.email },
      });

      if (!user) {
        this.logger.warn('User not found', { email: loginDto.email });
        throw new UnauthorizedException('Invalid credentials');
      }

      if (!user.status) {
        this.logger.warn('User account is not active', {
          email: loginDto.email,
        });
        throw new UnauthorizedException('Account is disabled');
      }

      try {
        if (user.keycloakUserId) {
          await this.keycloakService.authenticate();
          const keycloakClient = this.keycloakService.getClient();
          await keycloakClient.users.logout({ id: user.keycloakUserId });
        }

        const tokenData = await this.keycloakService.authenticateUser(
          loginDto.email,
          loginDto.password,
        );

        return {
          user: {
            id: user.id.toString(),
            email: user.email,
            name: user.name,
            username: user.email,
            enabled: user.status,
          },
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          tokenType: tokenData.tokenType,
          expiresIn: tokenData.expiresIn,
          refreshExpiresIn: tokenData.refreshExpiresIn,
        };
      } catch (keycloakError) {
        this.logger.error('Keycloak authentication failed', {
          error: keycloakError.message,
          email: loginDto.email,
        });
        throw new UnauthorizedException('Invalid credentials');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error('User login failed', {
        error: error.message,
        email: loginDto.email,
      });
      throw new UnauthorizedException('Login failed');
    }
  }

  async refreshToken(refreshToken: string): Promise<LoginResponseDto> {
    try {
      this.logger.debug('Refreshing token');

      if (!this.keycloakService.isConfigured()) {
        this.logger.error('Keycloak is not configured');
        throw new UnauthorizedException('Authentication service not available');
      }

      const tokenData = await this.keycloakService.refreshToken(refreshToken);

      const userEmail = extractEmailFromToken(tokenData.accessToken);

      const user = await this.prismaService.user.findUnique({
        where: { email: userEmail },
      });

      if (!user) {
        this.logger.warn('User not found in database', { email: userEmail });
        throw new UnauthorizedException('User not found');
      }

      if (!user.status) {
        this.logger.warn('User account is not active', { email: userEmail });
        throw new UnauthorizedException('Account is disabled');
      }

      this.logger.log('Token refresh successful', {
        expiresIn: tokenData.expiresIn,
      });

      return {
        user: {
          id: user.id.toString(),
          email: user.email,
          name: user.name,
          username: user.email,
          enabled: user.status,
        },
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        tokenType: tokenData.tokenType,
        expiresIn: tokenData.expiresIn,
        refreshExpiresIn: tokenData.refreshExpiresIn,
      };
    } catch (error) {
      this.logger.error('Token refresh failed', {
        error: error.message,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async assignToGroup(
    assignGroupDto: AssignGroupDto,
  ): Promise<{ success: boolean; message: string }> {
    const { userId, groupName } = assignGroupDto;

    if (!this.keycloakService.isConfigured()) {
      throw new UnauthorizedException('Authentication service not available');
    }

    await this.keycloakService.addUserToGroup(userId, groupName);

    this.logger.log('User assigned to group successfully', {
      userId,
      groupName,
    });

    return {
      success: true,
      message: `User assigned to group "${groupName}" successfully`,
    };
  }
}
