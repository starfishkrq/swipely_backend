import type { FastifyInstance } from "fastify";
import {
  StatusSubscriptionService,
  type EntityType,
  type TriggerStatus,
  type DeliveryChannel,
  type DigestFrequency,
} from "../../services/statusSubscription.service.js";
import { validateRequest } from "../middleware/validation.js";
import {
  SubscriptionUserParamsSchema,
  SubscriptionIdParamsSchema,
  CreateSubscriptionBodySchema,
  UpdateSubscriptionBodySchema,
  NotifySubscriptionBodySchema,
} from "../validations/statusSubscriptions.schema.js";

const ENTITY_TYPES: EntityType[] = ["asset", "bridge", "service"];
const TRIGGER_STATUSES: TriggerStatus[] = ["degraded", "down", "recovered", "any"];
const DELIVERY_CHANNELS: DeliveryChannel[] = ["in_app", "email", "webhook", "discord"];
const DIGEST_FREQUENCIES: DigestFrequency[] = ["immediate", "hourly", "daily"];

const subscriptionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    entityType: { type: "string", enum: ENTITY_TYPES },
    entityId: { type: "string" },
    triggerStatuses: { type: "array", items: { type: "string", enum: TRIGGER_STATUSES } },
    deliveryChannels: { type: "array", items: { type: "string", enum: DELIVERY_CHANNELS } },
    deliveryDestination: { type: "string" },
    digestFrequency: { type: "string", enum: DIGEST_FREQUENCIES },
    suppressDuplicatesMinutes: { type: "integer" },
    enabled: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
} as const;

export async function statusSubscriptionsRoutes(server: FastifyInstance) {
  const service = new StatusSubscriptionService();

  server.post<{
    Params: { userId: string };
    Body: {
      entityType: EntityType;
      entityId: string;
      triggerStatuses?: TriggerStatus[];
      deliveryChannels?: DeliveryChannel[];
      deliveryDestination?: string;
      digestFrequency?: DigestFrequency;
      suppressDuplicatesMinutes?: number;
    };
  }>(
    "/:userId",
    {
      preHandler: validateRequest({ params: SubscriptionUserParamsSchema, body: CreateSubscriptionBodySchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Create a status change subscription",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["entityType", "entityId"],
          properties: {
            entityType: { type: "string", enum: ENTITY_TYPES },
            entityId: { type: "string", minLength: 1 },
            triggerStatuses: { type: "array", items: { type: "string", enum: TRIGGER_STATUSES } },
            deliveryChannels: { type: "array", items: { type: "string", enum: DELIVERY_CHANNELS } },
            deliveryDestination: { type: "string" },
            digestFrequency: { type: "string", enum: DIGEST_FREQUENCIES },
            suppressDuplicatesMinutes: { type: "integer", minimum: 0, maximum: 10080 },
          },
        },
        response: {
          201: { type: "object", properties: { subscription: subscriptionSchema } },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { userId } = request.params;
      const sub = service.create({ userId, ...request.body });
      return reply.status(201).send({ subscription: sub });
    },
  );

  server.get<{ Params: { userId: string } }>(
    "/:userId",
    {
      preHandler: validateRequest({ params: SubscriptionUserParamsSchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "List all subscriptions for a user",
        params: {
          type: "object",
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            properties: { subscriptions: { type: "array", items: subscriptionSchema } },
          },
        },
      },
    },
    async (request) => {
      const subs = service.listByUser(request.params.userId);
      return { subscriptions: subs };
    },
  );

  server.get<{ Params: { userId: string; id: string } }>(
    "/:userId/:id",
    {
      preHandler: validateRequest({ params: SubscriptionIdParamsSchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Get a single subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: {
            userId: { type: "string" },
            id: { type: "string" },
          },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const sub = service.getById(request.params.id);
      if (!sub || sub.userId !== request.params.userId) {
        return reply.status(404).send({ error: "Subscription not found" });
      }
      return { subscription: sub };
    },
  );

  server.patch<{
    Params: { userId: string; id: string };
    Body: {
      triggerStatuses?: TriggerStatus[];
      deliveryChannels?: DeliveryChannel[];
      deliveryDestination?: string;
      digestFrequency?: DigestFrequency;
      suppressDuplicatesMinutes?: number;
      enabled?: boolean;
    };
  }>(
    "/:userId/:id",
    {
      preHandler: validateRequest({ params: SubscriptionIdParamsSchema, body: UpdateSubscriptionBodySchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Update a subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            triggerStatuses: { type: "array", items: { type: "string", enum: TRIGGER_STATUSES } },
            deliveryChannels: { type: "array", items: { type: "string", enum: DELIVERY_CHANNELS } },
            deliveryDestination: { type: "string" },
            digestFrequency: { type: "string", enum: DIGEST_FREQUENCIES },
            suppressDuplicatesMinutes: { type: "integer", minimum: 0, maximum: 10080 },
            enabled: { type: "boolean" },
          },
        },
        response: {
          200: { type: "object", properties: { subscription: subscriptionSchema } },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const updated = service.update(request.params.id, request.params.userId, request.body);
      if (!updated) return reply.status(404).send({ error: "Subscription not found" });
      return { subscription: updated };
    },
  );

  server.delete<{ Params: { userId: string; id: string } }>(
    "/:userId/:id",
    {
      preHandler: validateRequest({ params: SubscriptionIdParamsSchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Delete a subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
        response: {
          200: { type: "object", properties: { deleted: { type: "boolean" } } },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const ok = service.delete(request.params.id, request.params.userId);
      if (!ok) return reply.status(404).send({ error: "Subscription not found" });
      return { deleted: true };
    },
  );

  server.get<{ Params: { userId: string; id: string } }>(
    "/:userId/:id/audit",
    {
      preHandler: validateRequest({ params: SubscriptionIdParamsSchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Get audit trail for a subscription",
        params: {
          type: "object",
          required: ["userId", "id"],
          properties: { userId: { type: "string" }, id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              audit: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    subscriptionId: { type: "string" },
                    userId: { type: "string" },
                    action: { type: "string" },
                    detail: { type: "string" },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const sub = service.getById(request.params.id);
      if (!sub || sub.userId !== request.params.userId) {
        return reply.status(404).send({ error: "Subscription not found" });
      }
      return { audit: service.getAuditTrail(request.params.id) };
    },
  );

  // Internal endpoint — called by the status-change event pipeline
  server.post<{
    Body: { entityType: string; entityId: string; newStatus: string };
  }>(
    "/notify",
    {
      preHandler: validateRequest({ body: NotifySubscriptionBodySchema }),
      schema: {
        tags: ["Status Subscriptions"],
        summary: "Trigger subscription notifications for a status change (internal)",
        body: {
          type: "object",
          required: ["entityType", "entityId", "newStatus"],
          properties: {
            entityType: { type: "string", enum: ENTITY_TYPES },
            entityId: { type: "string" },
            newStatus: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { notified: { type: "integer" } },
          },
          400: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const { entityType, entityId, newStatus } = request.body;
      if (!ENTITY_TYPES.includes(entityType as EntityType)) {
        return reply.status(400).send({ error: "Invalid entityType" });
      }
      const matched = service.getSubscriptionsToNotify(entityType as EntityType, entityId, newStatus);
      return { notified: matched.length };
    },
  );
}
