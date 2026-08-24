import { z } from "zod";

const bridgeTxStatusSchema = z.enum(["pending", "confirmed", "failed", "cancelled", "processing"]);

export const BridgeParamsSchema = z.object({
  bridge: z.string().min(1).max(100),
});

export const BridgeTxParamsSchema = z.object({
  bridge: z.string().min(1).max(100),
  txHash: z.string().min(1).max(255),
});

export const BridgeSnapshotQuerySchema = z.object({
  bypassCache: z.coerce.boolean().optional().default(false),
});

export const BridgeTransactionsQuerySchema = z.object({
  status: bridgeTxStatusSchema.optional(),
});

export const CreateBridgeTransactionBodySchema = z.object({
  symbol: z.string().min(1).max(20),
  transactionType: z.enum(["mint", "burn", "transfer"]),
  txHash: z.string().min(1).max(255),
  sourceChain: z.string().min(1).max(100).optional(),
  sourceAddress: z.string().min(1).max(255).optional(),
  destinationAddress: z.string().min(1).max(255).optional(),
  amount: z.string().min(1).max(50),
  fee: z.string().min(1).max(50).optional(),
  status: bridgeTxStatusSchema.optional().default("pending"),
  correlationId: z.string().min(1).max(255).optional(),
  submittedAt: z.string().datetime().optional(),
});

export const UpdateBridgeTxStatusBodySchema = z.object({
  status: bridgeTxStatusSchema,
  errorMessage: z.string().max(1000).optional(),
});
