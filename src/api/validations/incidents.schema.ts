import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const statusSchema = z.enum(["open", "investigating", "resolved"]);

export const ListIncidentsQuerySchema = z.object({
  bridgeId: z.string().min(1).max(255).optional(),
  assetCode: z.string().min(1).max(20).optional(),
  severity: severitySchema.optional(),
  status: statusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const IncidentIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const CreateIncidentBodySchema = z.object({
  bridgeId: z.string().min(1).max(255),
  assetCode: z.string().min(1).max(20).optional(),
  severity: severitySchema,
  title: z.string().min(1).max(255),
  description: z.string().min(1).max(5000),
  sourceUrl: z.string().url().optional(),
  sourceType: z.string().min(1).max(100).optional(),
  sourceExternalId: z.string().min(1).max(255).optional(),
  sourceRepository: z.string().min(1).max(255).optional(),
  sourceRepoAvatarUrl: z.string().url().optional(),
  sourceActor: z.string().min(1).max(255).optional(),
  sourceAttribution: z.record(z.string(), z.unknown()).optional(),
  followUpActions: z.array(z.string().min(1).max(500)).max(50).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const IngestIncidentBodySchema = z.object({
  sourceType: z.string().min(1).max(100).optional(),
  externalId: z.string().min(1).max(255).optional(),
  bridgeId: z.string().min(1).max(255).optional(),
  assetCode: z.string().min(1).max(20).optional(),
  severity: z.string().min(1).max(50).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).optional(),
  sourceUrl: z.string().url().optional(),
  occurredAt: z.string().optional(),
  repository: z.string().min(1).max(255).optional(),
  repoAvatarUrl: z.string().url().optional(),
  actor: z.string().min(1).max(255).optional(),
  followUpActions: z.array(z.string().min(1).max(500)).max(50).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  source: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateIncidentStatusBodySchema = z.object({
  status: statusSchema,
});

export const MarkIncidentReadBodySchema = z.object({
  userSession: z.string().min(1).max(255),
});

export const UnreadCountQuerySchema = z.object({
  userSession: z.string().min(1).max(255),
});

export const ReviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
