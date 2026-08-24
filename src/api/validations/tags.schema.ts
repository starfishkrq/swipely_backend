import { z } from "zod";

export const AddTagBodySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
  tag: z.string().min(1).max(100),
  source: z.string().min(1).max(100).optional(),
});

export const RemoveTagBodySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
  tag: z.string().min(1).max(100),
  source: z.string().min(1).max(100).optional(),
});

export const SyncTagsBodySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
  tags: z.array(z.string().min(1).max(100)).max(200),
  source: z.string().min(1).max(100).optional(),
});

export const PropagateTagBodySchema = z.object({
  tag: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityIds: z.array(z.string().min(1).max(255)).min(1).max(500),
  source: z.string().min(1).max(100).optional(),
});

export const FindTagsQuerySchema = z.object({
  tag: z.string().min(1).max(100),
  type: z.string().min(1).max(100).optional(),
});

export const TagEntityParamsSchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
});

export const TagAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
