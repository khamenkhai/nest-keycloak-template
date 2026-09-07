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
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('API Documentation')
      .setDescription('The official API documentation for the POS system.')
      .setVersion('1.0')
      .addBearerAuth()
      .addServer(`/`, 'Direct Server')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Standard Swagger UI
    SwaggerModule.setup('swagger', app, document, {
      jsonDocumentUrl: 'swagger/json',
    });

    // Modern Scalar UI
    app.use(
      '/reference',
      apiReference({
        content: document,
      }),
    );
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

    logger.log(
      `${blue}Swagger Documentation: http://localhost:${port}/swagger${reset}`,
    );
    logger.log(
      `${blue}Scalar Documentation: http://localhost:${port}/reference${reset}`,
    );
  }

  const logger = new Logger('Bootstrap');
  logger.log(`Server is running on http://localhost:${port}`);
}

bootstrap();
