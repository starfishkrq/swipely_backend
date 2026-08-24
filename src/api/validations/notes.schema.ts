import { z } from "zod";

export const CreateNoteBodySchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
  operatorAddress: z.string().min(1).max(255),
  content: z.string().min(1).max(10000),
  category: z.string().min(1).max(100).optional(),
  isInternal: z.boolean().optional(),
});

export const UpdateNoteBodySchema = z.object({
  operatorAddress: z.string().min(1).max(255),
  content: z.string().min(1).max(10000).optional(),
  category: z.string().min(1).max(100).optional(),
  isInternal: z.boolean().optional(),
}).refine(
  (data) => data.content !== undefined || data.category !== undefined || data.isInternal !== undefined,
  { message: "At least one of content, category, or isInternal must be provided" }
);

export const NoteIdParamsSchema = z.object({
  id: z.string().min(1).max(255),
});

export const DeleteNoteQuerySchema = z.object({
  operatorAddress: z.string().min(1).max(255),
});

export const SearchNotesQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const NoteEntityParamsSchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(255),
});

export const NoteOperatorParamsSchema = z.object({
  operatorAddress: z.string().min(1).max(255),
});
