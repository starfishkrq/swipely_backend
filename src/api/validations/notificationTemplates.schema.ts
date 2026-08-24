import { z } from "zod";

export const TemplateIdParamsSchema = z.object({
  templateId: z.string().min(1).max(255),
});

export const CreateTemplateBodySchema = z.object({
  name: z.string().min(1).max(100),
  channel: z.enum(["email", "webhook", "in_app", "discord"]),
  subject: z.string().min(1).max(255).optional(),
  body: z.string().min(1).max(10000),
  variables: z.array(z.string().min(1).max(100)).optional(),
  status: z.enum(["draft", "pending_approval", "approved", "archived"]).optional(),
  createdBy: z.string().min(1).max(255).optional(),
});

export const UpdateTemplateBodySchema = z.object({
  updates: z.record(z.string(), z.unknown()),
  updatedBy: z.string().min(1).max(255),
});

export const ApproveTemplateBodySchema = z.object({
  approvedBy: z.string().min(1).max(255),
});

export const PreviewTemplateBodySchema = z.object({
  variables: z.record(z.string(), z.string()),
});

export const ValidateTemplateBodySchema = z.object({
  body: z.string().min(1).max(10000),
  subject: z.string().max(255).optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

export const ListTemplatesQuerySchema = z.object({
  channel: z.enum(["email", "webhook", "in_app", "discord"]).optional(),
  status: z.enum(["draft", "pending_approval", "approved", "archived"]).optional(),
});
