import { z } from "zod";

const entityTypeSchema = z.enum(["asset", "bridge", "service"]);
const triggerStatusSchema = z.enum(["degraded", "down", "recovered", "any"]);
const deliveryChannelSchema = z.enum(["in_app", "email", "webhook", "discord"]);
const digestFrequencySchema = z.enum(["immediate", "hourly", "daily"]);

export const SubscriptionUserParamsSchema = z.object({
  userId: z.string().min(1).max(255),
});

export const SubscriptionIdParamsSchema = z.object({
  userId: z.string().min(1).max(255),
  id: z.string().min(1).max(255),
});

export const CreateSubscriptionBodySchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().min(1).max(255),
  triggerStatuses: z.array(triggerStatusSchema).optional(),
  deliveryChannels: z.array(deliveryChannelSchema).optional(),
  deliveryDestination: z.string().max(500).optional(),
  digestFrequency: digestFrequencySchema.optional(),
  suppressDuplicatesMinutes: z.number().int().min(0).max(10080).optional(),
});

export const UpdateSubscriptionBodySchema = z.object({
  triggerStatuses: z.array(triggerStatusSchema).optional(),
  deliveryChannels: z.array(deliveryChannelSchema).optional(),
  deliveryDestination: z.string().max(500).optional(),
  digestFrequency: digestFrequencySchema.optional(),
  suppressDuplicatesMinutes: z.number().int().min(0).max(10080).optional(),
  enabled: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: "At least one field must be provided for update",
});

export const NotifySubscriptionBodySchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().min(1).max(255),
  newStatus: z.string().min(1).max(100),
});
