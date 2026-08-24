import { z } from "zod";

const webhookEventTypeSchema = z.enum([
  "alert_triggered",
  "alert_resolved",
  "bridge_status_change",
  "asset_health_change",
  "price_deviation",
  "supply_mismatch",
]);

const webhookDeliveryStatusSchema = z.enum([
  "pending",
  "delivered",
  "failed",
  "retrying",
]);

export const CreateWebhookEndpointBodySchema = z.object({
  ownerAddress: z.string().min(1).max(255),
  url: z.string().url(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(3600).optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  eventTypes: z.array(webhookEventTypeSchema).optional(),
  isBatchDeliveryEnabled: z.boolean().optional(),
  batchWindowMs: z.number().int().min(100).max(60000).optional(),
});

export const UpdateWebhookEndpointBodySchema = z.object({
  url: z.string().url().optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  rateLimitPerMinute: z.number().int().min(1).max(3600).optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  eventTypes: z.array(webhookEventTypeSchema).optional(),
  isBatchDeliveryEnabled: z.boolean().optional(),
  batchWindowMs: z.number().int().min(100).max(60000).optional(),
}).refine((val) => Object.keys(val).length > 0, {
  message: "At least one field must be provided for update",
});

export const WebhookEndpointParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const WebhookDeliveryQuerySchema = z.object({
  status: webhookDeliveryStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const QueueDeliveryBodySchema = z.object({
  webhookEndpointId: z.string().min(1).max(255),
  eventType: webhookEventTypeSchema,
  payload: z.record(z.string(), z.any()),
});

export const QueueBatchDeliveryBodySchema = z.object({
  webhookEndpointId: z.string().min(1).max(255),
  eventType: webhookEventTypeSchema,
  events: z.array(z.record(z.string(), z.any())).min(1).max(100),
});

export const VerifySignatureBodySchema = z.object({
  payload: z.string().min(1),
  signature: z.string().min(1),
  timestamp: z.string().min(1),
  secret: z.string().min(1),
});

export const DeliveryLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
