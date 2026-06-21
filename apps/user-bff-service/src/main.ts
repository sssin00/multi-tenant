import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadAppConfig } from "./config/app.config.js";

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  app.enableCors({
    origin: config.cors.allowedOrigins,
    methods: config.cors.allowedMethods,
    allowedHeaders: config.cors.allowedHeaders,
    exposedHeaders: config.cors.exposedHeaders,
    credentials: config.cors.credentials,
    maxAge: config.cors.maxAgeSeconds
  });

  await app.listen(config.port, "0.0.0.0");

  Logger.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      service: config.serviceName,
      env: config.env,
      port: config.port,
      message: "user-bff-service started"
    }),
    "Bootstrap"
  );
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "user-bff-service",
      message: "failed to start user-bff-service",
      error: error instanceof Error ? error.message : String(error)
    }),
    "Bootstrap"
  );
  process.exit(1);
});
