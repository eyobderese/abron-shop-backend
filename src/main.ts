import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );
  const config = app.get(ConfigService);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, {
    root: resolve(config.get('MEDIA_LOCAL_DIR') ?? 'uploads'),
    prefix: '/uploads/',
  });
  app.enableCors({
    origin: (config.get('FRONTEND_ORIGIN') ?? 'http://localhost:5173').split(',').map((v: string) => v.trim()),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Abron Shop API').setVersion('1.0').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
  await app.listen(Number(config.get('PORT') ?? 3000), '0.0.0.0');
}

bootstrap();
