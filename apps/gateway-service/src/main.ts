import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { getAppConfig } from "./config/app.config.js";

async function bootstrap() {
  const config = getAppConfig();
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
}

void bootstrap();
