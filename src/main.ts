import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody is required so the inbound-email webhook can verify its HMAC over
  // the exact bytes received — re-serialising the parsed JSON would change key
  // order and whitespace, and the signature would never match.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.use(
    helmet({
      // This is a JSON API consumed by the web app on a different origin, so
      // helmet's default same-origin resource policy is the wrong default here.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // CSP protects documents; nothing is served from this origin.
      contentSecurityPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string[]>('corsOrigins'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = config.get<number>('port') ?? 4000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
