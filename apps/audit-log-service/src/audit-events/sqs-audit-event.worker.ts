import { setTimeout as sleep } from "node:timers/promises";

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message
} from "@aws-sdk/client-sqs";

import { getAppConfig, type AppConfig } from "../config/app.config.js";
import { AuditLogEventConsumer } from "./audit-log-event.consumer.js";

@Injectable()
export class SqsAuditEventWorker implements OnModuleInit, OnModuleDestroy {
  private readonly config: AppConfig = getAppConfig();
  private readonly sqsClient: SQSClient;
  private stopping = false;
  private started = false;

  constructor(
    @Inject(AuditLogEventConsumer)
    private readonly auditLogEventConsumer: AuditLogEventConsumer
  ) {
    this.sqsClient = new SQSClient({
      endpoint: this.config.eventConsumer.sqsEndpoint
    });
  }

  onModuleInit(): void {
    if (!this.config.eventConsumer.enabled) {
      this.log("info", "Audit event SQS consumer is disabled");
      return;
    }

    if (!this.config.eventConsumer.queueUrl) {
      this.log("error", "AUDIT_EVENT_QUEUE_URL is required when audit event consumer is enabled");
      return;
    }

    this.started = true;
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.sqsClient.destroy();
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.log("error", "Audit event SQS poll failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }

      if (!this.stopping) {
        await sleep(this.config.eventConsumer.pollIntervalMs);
      }
    }
  }

  private async pollOnce(): Promise<void> {
    const queueUrl = this.config.eventConsumer.queueUrl;
    if (!queueUrl) {
      return;
    }

    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: Math.min(Math.max(this.config.eventConsumer.batchSize, 1), 10),
        WaitTimeSeconds: Math.min(Math.max(this.config.eventConsumer.waitTimeSeconds, 0), 20),
        VisibilityTimeout: Math.max(this.config.eventConsumer.visibilityTimeoutSeconds, 1),
        MessageAttributeNames: ["All"],
        AttributeNames: ["All"]
      })
    );

    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      return;
    }

    for (const message of messages) {
      await this.processMessage(queueUrl, message);
    }
  }

  private async processMessage(queueUrl: string, message: Message): Promise<void> {
    const messageId = message.MessageId ?? "unknown";

    try {
      await this.auditLogEventConsumer.handleSqsEvent({
        Records: [
          {
            body: message.Body
          }
        ]
      });

      if (message.ReceiptHandle) {
        await this.sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
          })
        );
      }

      this.log("info", "Audit event SQS message consumed", { messageId });
    } catch (error) {
      this.log("error", "Audit event SQS message failed", {
        messageId,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private log(level: "info" | "error", message: string, fields: Record<string, unknown> = {}): void {
    const logRecord = {
      timestamp: new Date().toISOString(),
      level,
      service: this.config.serviceName,
      env: this.config.env,
      message,
      consumerEnabled: this.config.eventConsumer.enabled,
      queueConfigured: Boolean(this.config.eventConsumer.queueUrl),
      started: this.started,
      ...fields
    };

    const line = JSON.stringify(logRecord);
    if (level === "error") {
      console.error(line);
      return;
    }

    console.log(line);
  }
}
