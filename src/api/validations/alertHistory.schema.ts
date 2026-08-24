import { z } from "zod";

export const AlertHistorySearchQuerySchema = z.object({
  assetCode: z.string().min(1).max(20).optional(),
  alertType: z.string().min(1).max(100).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(500).optional().default(20),
});
