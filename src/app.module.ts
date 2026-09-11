import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, RouterModule } from '@nestjs/core';
import { LoggerModule } from './common/logger/logger.module';
import { HttpLoggerMiddleware } from './common/logger/http-logger.middleware';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import {
  AuthGuard,
  KeycloakConnectModule,
  ResourceGuard,
} from 'nest-keycloak-connect';
import { KeycloakConfig } from './keycloak/keyclock';
import { KeycloakConfigModule } from './keycloak/keycloak-config.module';
import { KeycloakModule } from './keycloak';
import { UserMiddleware } from './common/middlewares/user.middleware';
import { UploadModule } from './common/upload/upload.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PostsModule } from './modules/posts/posts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public', 'uploads'),
      serveRoot: '/files',
      exclude: ['/api/(.*)'],
    }),
    ThrottlerModule.forRoot({
      skipIf: () =>
        (process.env.THROTTLE_ENABLED ?? 'true').toLowerCase() === 'false',
      throttlers: [
        { name: 'short', ttl: 1000, limit: 30 },
        { name: 'medium', ttl: 60000, limit: 100 },
        { name: 'long', ttl: 86400000, limit: 3000 },
      ],
    }),
    RouterModule.register([
      {
        path: 'api',
        children: [
          { path: '/v1/auth', module: AuthModule },
          { path: '/v1/categories', module: CategoriesModule },
          { path: '/v1/posts', module: PostsModule },
          { path: '/v1/keycloak', module: KeycloakModule },
        ],
      },
    ]),
    KeycloakConnectModule.registerAsync({
      useExisting: KeycloakConfig,
      imports: [KeycloakConfigModule],
    }),
    PrismaModule,
    AuthModule,
    CategoriesModule,
    PostsModule,
    UploadModule,
    KeycloakModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ResourceGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
  controllers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware, UserMiddleware).forRoutes('*');
  }
}
