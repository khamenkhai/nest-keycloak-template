import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';
import { decode, type JwtPayload } from 'jsonwebtoken';

export interface ExpressRequest extends Request {
  currentUser: {
    posID: string | null;
    from: 'ADMIN' | 'ORG';
  };
}

export class UserMiddleware implements NestMiddleware {
  async use(req: ExpressRequest, res: Response, next: (error?: Error) => void) {
    // Shop dashboard authenticates with an httpOnly access_token cookie. The
    // Keycloak AuthGuard only reads the Authorization header, so bridge the
    // cookie into it before the guard runs.
    const cookieAccessToken = (
      req as ExpressRequest & { cookies?: Record<string, string> }
    ).cookies?.access_token;
    if (!req.headers.authorization && cookieAccessToken) {
      req.headers.authorization = `Bearer ${cookieAccessToken}`;
    }

    const authorization = req.headers.authorization;
    let posID: string | null = null;
    let from: 'ADMIN' | 'ORG' = 'ADMIN';

    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : null;

    if (token) {
      const user = decode(token);

      if (user && typeof user !== 'string') {
        const rawPosID = (user as JwtPayload & { posID?: string }).posID;
        const rawPosIDStr = rawPosID != null ? String(rawPosID) : null;

        posID = rawPosIDStr ? (rawPosIDStr.split('-')[1] ?? null) : null;
        from = rawPosIDStr?.startsWith('Org-') ? 'ORG' : 'ADMIN';
      }
    }

    req.currentUser = {
      posID,
      from,
    };

    next();
  }
}
