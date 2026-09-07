import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '-';
    const startTime = Date.now();

    // Log response when it finishes
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length') || 0;
      const duration = Date.now() - startTime;

      const message = `${method} ${originalUrl} ${statusCode} ${duration}ms ${contentLength}`;

      const meta = {
        context: 'HTTP',
        method,
        url: originalUrl,
        statusCode,
        duration: `${duration}ms`,
        contentLength,
        ip,
        userAgent,
      };

      // Color-code by status
      if (statusCode >= 500) {
        this.logger.error(message, meta);
      } else if (statusCode >= 400) {
        this.logger.warn(message, meta);
      } else {
        this.logger.info(message, meta);
      }
    });

    next();
  }
}
