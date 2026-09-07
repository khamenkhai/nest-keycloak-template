import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
  path: string;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | any> {
    if (context.getType<'http' | 'rpc'>() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const isMobile = request.route.path.includes('mobile');
    const isMetrics =
      request.route.path.includes('metrics') ||
      request.url.includes('/metrics');

    // Skip interceptor for metrics endpoint - return raw Prometheus format
    if (isMetrics) {
      return next.handle();
    }

    if (isMobile) {
      return next.handle().pipe(
        map((data) => ({
          authorized: true,
          success: response.statusCode >= 200 && response.statusCode < 300,
          message: this.getSuccessMessage(request.method),
          data,
          timestamp: new Date().toISOString(),
          path: request.url,
        })),
      );
    }

    return next.handle().pipe(
      map((data) => ({
        success: response.statusCode >= 200 && response.statusCode < 300,
        message: this.getSuccessMessage(request.method),
        data,
        timestamp: new Date().toISOString(),
        path: request.url,
      })),
    );
  }

  private getSuccessMessage(method: string): string {
    const messages = {
      GET: 'Data retrieved successfully',
      POST: 'Resource created successfully',
      PUT: 'Resource updated successfully',
      PATCH: 'Resource updated successfully',
      DELETE: 'Resource deleted successfully',
    };

    return messages[method] || 'Operation completed successfully';
  }
}
