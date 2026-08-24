import { z } from "zod";

const logicOperatorSchema = z.enum(["AND", "OR"]);
const rulePrioritySchema = z.enum(["critical", "high", "medium", "low"]);
const alertRuleStatusSchema = z.enum(["active", "inactive", "paused"]);

const ruleConditionSchema = z.object({
  metric: z.string().min(1).max(100),
  operator: z.enum(["gt", "lt", "eq", "gte", "lte", "ne"]),
  threshold: z.number(),
  alertType: z
    .enum([
      "price_deviation",
      "supply_mismatch",
      "bridge_downtime",
      "health_score_drop",
      "volume_anomaly",
      "reserve_ratio_breach",
    ])
    .optional(),
});

const timeWindowSchema = z.object({
  durationSeconds: z.number().int().positive(),
  aggregation: z.enum(["avg", "sum", "min", "max", "count"]).optional(),
});

export const CreateAlertRuleBodySchema = z.object({
  ownerAddress: z.string().min(1).max(255),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  assetCode: z.string().min(1).max(20),
  conditions: z.array(ruleConditionSchema).min(1).max(20),
  logicOperator: logicOperatorSchema.optional().default("AND"),
  priority: rulePrioritySchema.optional().default("medium"),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
  timeWindow: timeWindowSchema.optional(),
  webhookUrl: z.string().url().optional(),
  templateId: z.string().min(1).max(255).optional(),
  status: alertRuleStatusSchema.optional(),
});

export const UpdateAlertRuleBodySchema = z
  .object({
    changedBy: z.string().min(1).max(255),
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    conditions: z.array(ruleConditionSchema).min(1).max(20).optional(),
    logicOperator: logicOperatorSchema.optional(),
    priority: rulePrioritySchema.optional(),
    status: alertRuleStatusSchema.optional(),
    cooldownSeconds: z.number().int().min(0).max(86400).optional(),
    timeWindow: timeWindowSchema.nullable().optional(),
    webhookUrl: z.string().url().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 1, {
    message: "At least one field besides changedBy must be provided",
  });

export const SetAlertRuleStatusBodySchema = z.object({
  status: alertRuleStatusSchema,
});

export const TestAlertRuleBodySchema = z.object({
  metrics: z.record(z.string(), z.number()),
  previousMetrics: z.record(z.string(), z.number()).optional(),
});

export const EvaluateAlertRulesBodySchema = z.object({
  assetCode: z.string().min(1).max(20),
  metrics: z.record(z.string(), z.number()),
  previousMetrics: z.record(z.string(), z.number()).optional(),
});

export const AlertRuleIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const ListAlertRulesQuerySchema = z.object({
  ownerAddress: z.string().min(1).max(255).optional(),
  assetCode: z.string().min(1).max(20).optional(),
  status: alertRuleStatusSchema.optional(),
  priority: rulePrioritySchema.optional(),
});
