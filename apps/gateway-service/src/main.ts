import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";

import { AppModule } from "./app.module.js";
import { getAppConfig } from "./config/app.config.js";
import { GlobalExceptionFilter } from "./errors/global-exception.filter.js";

async function bootstrap() {
  const config = getAppConfig();
  const app = await NestFactory.create(AppModule, {
    bodyParser: false
  });

  app.enableShutdownHooks();
  app.useGlobalFilters(app.get(GlobalExceptionFilter));
  app.enableCors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, config.cors.allowedOrigins.includes(origin));
    },
    methods: config.cors.allowedMethods,
    allowedHeaders: config.cors.allowedHeaders,
    exposedHeaders: config.cors.exposedHeaders,
    credentials: config.cors.credentials,
    maxAge: config.cors.maxAgeSeconds,
    optionsSuccessStatus: 204
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      res.status(204).send();
      return;
    }

    next();
  });

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
