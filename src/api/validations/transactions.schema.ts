import { z } from "zod";

const txStatusSchema = z.enum(["pending", "completed", "failed"]);

export const TransactionsListQuerySchema = z.object({
  bridge: z.string().min(1).max(100).optional(),
  asset: z.string().min(1).max(20).optional(),
  status: txStatusSchema.optional(),
  operationType: z.string().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(10),
});

export const TransactionsExportQuerySchema = z.object({
  bridge: z.string().min(1).max(100).optional(),
  asset: z.string().min(1).max(20).optional(),
  status: txStatusSchema.optional(),
  operationType: z.string().min(1).max(100).optional(),
  search: z.string().max(200).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  format: z.enum(["csv"]).optional().default("csv"),
});

export const FetchTransactionsBodySchema = z.object({
  assetCode: z.string().min(1).max(20),
  assetIssuer: z.string().min(1).max(56),
  bridgeName: z.string().min(1).max(100).optional(),
  cursor: z.string().min(1).max(255).optional(),
  operationTypes: z.array(z.string().min(1).max(50)).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  maxPages: z.number().int().min(1).max(100).optional(),
});

export const BackfillTransactionsBodySchema = z.object({
  assetCode: z.string().min(1).max(20),
  assetIssuer: z.string().min(1).max(56),
  bridgeName: z.string().min(1).max(100).optional(),
  cursor: z.string().min(1).max(255).optional(),
  operationTypes: z.array(z.string().min(1).max(50)).optional(),
  pages: z.number().int().min(1).max(100).optional().default(25),
});

export const DetectNewTransactionsBodySchema = z.object({
  assetCode: z.string().min(1).max(20),
  assetIssuer: z.string().min(1).max(56),
  operationTypes: z.array(z.string().min(1).max(50)).optional(),
});

export const TransactionSyncStateParamsSchema = z.object({
  assetCode: z.string().min(1).max(20),
  assetIssuer: z.string().min(1).max(56),
});
