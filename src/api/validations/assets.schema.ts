import { z } from "zod";
import { AssetSymbolSchema } from "./common.schema.js";

export const AssetSymbolParamsSchema = z.object({
  symbol: AssetSymbolSchema,
});

export const AssetHealthHistoryQuerySchema = z.object({
  period: z.enum(["24h", "7d", "30d"]).optional().default("7d"),
});

export const CreateTagBodySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(20).nullable().optional(),
});

export const UpdateTagBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(20).nullable().optional(),
});

export const TagIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const BulkAssignTagsBodySchema = z.object({
  assetSymbols: z.array(z.string().min(1).max(20)).min(1).max(100),
  tagNames: z.array(z.string().min(1).max(100)).min(1).max(50),
});

export const AssignTagsToAssetBodySchema = z.object({
  tags: z.array(z.string().min(1).max(100)).min(1).max(50),
});

export const AssetTagParamsSchema = z.object({
  symbol: AssetSymbolSchema,
  tagName: z.string().min(1).max(100),
});
