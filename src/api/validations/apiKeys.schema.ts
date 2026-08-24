import { z } from "zod";

export const CreateApiKeyBodySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().min(1).max(100)).optional().default([]),
  rateLimitPerMinute: z.number().int().min(1).max(100000).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

export const ExtendApiKeyBodySchema = z.object({
  extraDays: z.number().int().min(1).max(3650),
});

export const ApiKeyIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});
