import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  KEYCLOAK_CONNECT_OPTIONS,
  KEYCLOAK_INSTANCE,
  KEYCLOAK_MULTITENANT_SERVICE,
  TokenValidation,
} from 'nest-keycloak-connect';
import { Request } from 'express';

@Injectable()
export class KeycloakAuthGuardLogger implements CanActivate {
  private readonly logger = new Logger(KeycloakAuthGuardLogger.name);

  constructor(
    @Inject(KEYCLOAK_INSTANCE) private readonly keycloak: any,
    @Inject(KEYCLOAK_CONNECT_OPTIONS) private readonly keycloakOpts: any,
    @Inject(KEYCLOAK_MULTITENANT_SERVICE) private readonly multiTenant: any,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const handler = context.getHandler();
    const className = context.getClass().name;
    const route = `${request.method} ${request.url}`;
    const label = `${className}.${handler.name}`;

    this.logger.log(`──────────────────────────────────────────`);
    this.logger.log(`🔒 AuthGuard: ${label} — ${route}`);

    // 1. Check @Public()
    const META_UNPROTECTED = 'unprotected';
    const META_SKIP_AUTH = 'skip-auth';

    const isUnprotected = this.reflector.getAllAndOverride<boolean>(
      META_UNPROTECTED,
      [handler, context.getClass()],
    );
    const skipAuth = this.reflector.getAllAndOverride<boolean>(META_SKIP_AUTH, [
      handler,
      context.getClass(),
    ]);

    if (isUnprotected && skipAuth) {
      this.logger.log(`  ✅ @Public() — skipping authentication`);
      return true;
    }

    // 2. Extract JWT
    const cookieKey = this.keycloakOpts?.cookieKey || 'KEYCLOAK_TOKEN';
    const jwtFromCookie = (request.cookies as any)?.[cookieKey];
    const jwtFromHeader = this.extractJwtFromHeader(request.headers);
    const jwt = jwtFromCookie ?? jwtFromHeader;
    const source = jwtFromCookie ? 'cookie' : 'header';

    if (!jwt) {
      this.logger.error(`  ❌ No JWT token found`);
      this.logger.error(
        `  Checked cookie "${cookieKey}": ${jwtFromCookie ? 'present' : 'absent'}`,
      );
      this.logger.error(
        `  Checked Authorization header: ${jwtFromHeader ? 'present' : 'absent'}`,
      );
      this.logger.error(
        `  Available headers: ${Object.keys(request.headers).join(', ')}`,
      );
      throw new UnauthorizedException();
    }

    this.logger.log(`  Token source: ${source}`);
    this.logger.log(`  Token length: ${jwt.length}`);

    // 3. Decode JWT payload
    let payload: any;
    try {
      payload = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'),
      );
      this.logger.log(`  ── JWT Payload ──`);
      this.logger.log(`  sub:            ${payload.sub}`);
      this.logger.log(`  email:          ${payload.email || 'N/A'}`);
      this.logger.log(
        `  preferred_username: ${payload.preferred_username || 'N/A'}`,
      );
      this.logger.log(`  iss:            ${payload.iss}`);
      this.logger.log(`  aud:            ${JSON.stringify(payload.aud)}`);
      this.logger.log(
        `  realm_access.roles: ${JSON.stringify(payload.realm_access?.roles || [])}`,
      );

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp) {
        const remaining = payload.exp - now;
        if (remaining <= 0) {
          this.logger.error(
            `  ❌ TOKEN EXPIRED! Expired ${Math.abs(remaining)}s ago`,
          );
        } else {
          this.logger.log(
            `  exp: ${new Date(payload.exp * 1000).toISOString()} (in ${remaining}s)`,
          );
        }
      }
    } catch (err: any) {
      this.logger.warn(`  ⚠ Could not decode JWT payload: ${err.message}`);
    }

    // 4. Resolve keycloak instance
    let resolvedKeycloak: any;
    try {
      if (!this.keycloakOpts?.realm) {
        const issuerRealm = payload?.iss?.split('/').pop();
        this.logger.log(`  Realm from issuer: ${issuerRealm}`);
        resolvedKeycloak = await this.multiTenant.get(issuerRealm, request);
      } else {
        this.logger.log(`  Realm: ${this.keycloakOpts.realm}`);
        resolvedKeycloak = this.keycloak;
      }
    } catch (err: any) {
      this.logger.error(
        `  ❌ Failed to resolve Keycloak instance: ${err.message}`,
      );
      throw new UnauthorizedException();
    }

    // 5. Validate token
    const tokenValidation =
      this.keycloakOpts?.tokenValidation || TokenValidation.ONLINE;
    this.logger.log(`  Token validation mode: ${tokenValidation}`);

    try {
      const gm = resolvedKeycloak.grantManager;

      // Create grant
      let grant;
      try {
        grant = await gm.createGrant({ access_token: jwt });
        this.logger.log(`  ✅ Grant created successfully`);
      } catch (ex: any) {
        this.logger.error(`  ❌ Failed to create grant: ${ex.message}`);
        throw new UnauthorizedException();
      }

      // Get the raw JWT string from the token object
      const accessToken = grant.access_token;
      const tokenString =
        typeof accessToken === 'string'
          ? accessToken
          : accessToken?.token || jwt;

      let result: any;

      switch (tokenValidation) {
        case TokenValidation.ONLINE:
          // validateAccessToken expects the raw JWT string
          result = await gm.validateAccessToken(tokenString);
          this.logger.log(
            `  validateAccessToken result type: ${typeof result}`,
          );
          this.logger.log(
            `  validateAccessToken result: ${typeof result === 'string' ? result.substring(0, 60) + '...' : result}`,
          );

          if (result) {
            this.logger.log(`  ✅ Token validated ONLINE`);
          } else {
            this.logger.error(`  ❌ Token validation returned: ${result}`);
            this.logger.error(`  The token was rejected by Keycloak server`);
            this.logger.error(`  ── Common causes ──`);
            this.logger.error(
              `  • Client "${this.keycloakOpts?.clientId}" may not have "Authorization Services" enabled`,
            );
            this.logger.error(
              `  • Client may not have the correct "Service Accounts" role`,
            );
            this.logger.error(
              `  • Token audience "${payload?.aud}" may not match the client`,
            );
            this.logger.error(
              `  • Keycloak server may be using a different issuer URL`,
            );
            throw new UnauthorizedException();
          }
          break;

        case TokenValidation.OFFLINE:
          result = await gm.validateToken(tokenString, 'Bearer');
          if (result) {
            this.logger.log(`  ✅ Token validated OFFLINE`);
          } else {
            this.logger.error(`  ❌ Token validation OFFLINE failed`);
            throw new UnauthorizedException();
          }
          break;

        case TokenValidation.NONE:
          this.logger.log(`  ⚠ Skipping validation (NONE mode)`);
          break;

        default:
          this.logger.error(`  ❌ Unknown validation mode: ${tokenValidation}`);
          throw new UnauthorizedException();
      }

      // Attach user to request
      request.user = payload;
      (request as any).accessTokenJWT = jwt;

      this.logger.log(`  ✅ Auth PASSED for ${label}`);
      this.logger.log(
        `  User: ${payload.sub} (${payload.preferred_username || payload.email})`,
      );
      this.logger.log(`──────────────────────────────────────────`);

      return true;
    } catch (error: any) {
      this.logger.error(`  ❌ Auth FAILED for ${label}: ${error.message}`);
      this.logger.log(`──────────────────────────────────────────`);
      throw error;
    }
  }

  private extractJwtFromHeader(headers: any): string | null {
    if (!headers?.authorization) return null;
    const parts = headers.authorization.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1];
  }
}
