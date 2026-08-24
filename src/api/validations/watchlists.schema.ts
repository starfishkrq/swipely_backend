import { z } from "zod";

export const WatchlistUserParamsSchema = z.object({
  userId: z.string().min(1).max(255),
});

export const WatchlistIdParamsSchema = z.object({
  userId: z.string().min(1).max(255),
  id: z.string().uuid(),
});

export const CreateWatchlistBodySchema = z.object({
  name: z.string().min(1).max(100),
  isDefault: z.boolean().optional().default(false),
});

export const UpdateWatchlistBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
  assets: z.array(z.string().min(1).max(20)).max(500).optional(),
}).refine((val) => Object.keys(val).length > 0, {
  message: "At least one field must be provided for update",
});
