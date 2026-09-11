import { UnauthorizedException } from '@nestjs/common';

export function decodeJwtToken(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT token');
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error: unknown) {
    throw new UnauthorizedException('Invalid token', { cause: error as Error });
  }
}

export function extractEmailFromToken(token: string): string {
  const payload = decodeJwtToken(token);
  const email = payload.email || payload.preferred_username;

  if (!email) {
    throw new UnauthorizedException('Email not found in token');
  }

  return email;
}

export function extractUserIdFromToken(token: string): string {
  const payload = decodeJwtToken(token);
  const userId = payload.sub || payload.id;

  if (!userId) {
    throw new UnauthorizedException('User ID not found in token');
  }

  return userId;
}
