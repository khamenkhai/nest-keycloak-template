import type { CookieOptions, Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

function baseCookieOptions(): CookieOptions {
  const secure = (process.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true';
  const sameSite = (process.env.COOKIE_SAMESITE ??
    'lax') as CookieOptions['sameSite'];
  const domain = process.env.COOKIE_DOMAIN || undefined;

  return {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
  };
}

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  const options = baseCookieOptions();

  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...options,
    maxAge: tokens.expiresIn * 1000,
  });

  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...options,
    maxAge: tokens.refreshExpiresIn * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  const options = baseCookieOptions();

  res.clearCookie(ACCESS_TOKEN_COOKIE, options);
  res.clearCookie(REFRESH_TOKEN_COOKIE, options);
}
