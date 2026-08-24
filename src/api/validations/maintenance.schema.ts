import { z } from "zod";

export const MaintenanceWindowIdParamsSchema = z.object({
  windowId: z.string().min(1).max(255),
});

export const CreateMaintenanceWindowBodySchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  scope: z.enum(["full", "partial", "asset", "bridge", "service"]).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  createdBy: z.string().min(1).max(255),
  affectedAssets: z.array(z.string().min(1).max(20)).max(100).optional(),
  affectedBridges: z.array(z.string().min(1).max(100)).max(100).optional(),
});

export const UpdateMaintenanceWindowBodySchema = z.object({
  updates: z.record(z.string(), z.unknown()),
  updatedBy: z.string().min(1).max(255),
});

export const ApproveMaintenanceWindowBodySchema = z.object({
  approvedBy: z.string().min(1).max(255),
});

export const CancelMaintenanceWindowBodySchema = z.object({
  cancelledBy: z.string().min(1).max(255),
});

export const CheckSuppressionBodySchema = z.object({
  alertType: z.string().min(1).max(100),
  scope: z.string().min(1).max(100).optional(),
});

export const UpcomingWindowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

export const ListMaintenanceWindowsQuerySchema = z.object({
  status: z.enum(["scheduled", "active", "completed", "cancelled"]).optional(),
  scope: z.enum(["full", "partial", "asset", "bridge", "service"]).optional(),
});
