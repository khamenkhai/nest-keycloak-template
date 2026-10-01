import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import cookieParser from 'cookie-parser';
import * as path from 'path';
import { AppModule } from './app.module';
import { PrismaClientExceptionFilter } from './common/interceptors/prisma-exception-filter';
import { AuthModule } from './modules/auth/auth.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PostsModule } from './modules/posts/posts.module';
import { KeycloakModule } from './keycloak';
import { RbacModule } from './modules/rbac/rbac.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // --- Logger ---
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // --- Proxy ---
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  // --- Static Assets ---
  app.useStaticAssets(path.join(process.cwd(), 'public'));

  // --- Environment & Constants ---
  const port = process.env.PORT ?? 3000;
  const isProduction = process.env.NODE_ENV === 'production';
  const globalPrefix = 'api';

  // --- Middleware & Security ---
  app.use(cookieParser());

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // --- Global NestJS Config ---
  app.setGlobalPrefix(globalPrefix, { exclude: ['/'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // --- Documentation (Development Only) ---
  const apiDocs = [
    { slug: 'auth', title: 'Auth API', modules: [AuthModule] },
    {
      slug: 'content',
      title: 'Content API',
      modules: [PostsModule, CategoriesModule],
    },
    {
      slug: 'admin',
      title: 'Admin API',
      modules: [KeycloakModule, RbacModule],
    },
  ];

  if (!isProduction) {
    for (const { slug, title, modules } of apiDocs) {
      const config = new DocumentBuilder()
        .setTitle(title)
        .setVersion('1.0')
        .addBearerAuth(undefined, 'Authorization')
        .addServer('/', 'Direct Server')
        .build();

      const document = SwaggerModule.createDocument(app, config, {
        include: modules,
      });

      // Standard Swagger UI
      SwaggerModule.setup(`docs/${slug}`, app, document, {
        jsonDocumentUrl: `docs/${slug}/json`,
      });

      // Modern Scalar UI
      app.use(
        `/reference/${slug}`,
        apiReference({
          content: document,
        }),
      );
    }
  }

  // --- Implement Prisma Exception Filter ---
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaClientExceptionFilter(httpAdapter));

  // --- Server Startup ---
  await app.listen(port);

  if (!isProduction) {
    const logger = new Logger('Bootstrap');
    const blue = '\x1b[34m';
    const reset = '\x1b[0m';

    for (const { slug, title } of apiDocs) {
      logger.log(
        `${blue}${title} — Swagger: http://localhost:${port}/docs/${slug} | Scalar: http://localhost:${port}/reference/${slug}${reset}`,
      );
    }
  }

  const logger = new Logger('Bootstrap');
  logger.log(`Server is running on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
