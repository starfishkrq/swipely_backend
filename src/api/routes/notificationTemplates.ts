import type { FastifyInstance } from "fastify";
import {
  notificationTemplateService,
  TemplateChannel,
  TemplateStatus,
} from "../../services/notificationTemplate.service";
import { validateRequest } from "../middleware/validation.js";
import {
  TemplateIdParamsSchema,
  CreateTemplateBodySchema,
  UpdateTemplateBodySchema,
  ApproveTemplateBodySchema,
  PreviewTemplateBodySchema,
  ValidateTemplateBodySchema,
  ListTemplatesQuerySchema,
} from "../validations/notificationTemplates.schema.js";

export async function notificationTemplatesRoutes(server: FastifyInstance) {
  // Create template
  server.post("/", { preHandler: validateRequest({ body: CreateTemplateBodySchema }) }, async (request, reply) => {
    const template = await notificationTemplateService.createTemplate(
      request.body as any,
    );
    return reply.code(201).send(template);
  });

  // Get template
  server.get<{ Params: { templateId: string } }>(
    "/:templateId",
    { preHandler: validateRequest({ params: TemplateIdParamsSchema }) },
    async (request, reply) => {
      const template = await notificationTemplateService.getTemplate(
        request.params.templateId,
      );
      if (!template) {
        return reply.code(404).send({ error: "Template not found" });
      }
      return template;
    },
  );

  // Update template
  server.patch<{
    Params: { templateId: string };
    Body: { updates: any; updatedBy: string };
  }>("/:templateId", { preHandler: validateRequest({ params: TemplateIdParamsSchema, body: UpdateTemplateBodySchema }) }, async (request, reply) => {
    const template = await notificationTemplateService.updateTemplate(
      request.params.templateId,
      request.body.updates,
      request.body.updatedBy,
    );
    if (!template) {
      return reply.code(404).send({ error: "Template not found" });
    }
    return template;
  });

  // Submit for approval
  server.post<{ Params: { templateId: string } }>(
    "/:templateId/submit",
    { preHandler: validateRequest({ params: TemplateIdParamsSchema }) },
    async (request, reply) => {
      await notificationTemplateService.submitForApproval(
        request.params.templateId,
      );
      return reply
        .code(200)
        .send({ message: "Template submitted for approval" });
    },
  );

  // Approve template
  server.post<{ Params: { templateId: string }; Body: { approvedBy: string } }>(
    "/:templateId/approve",
    { preHandler: validateRequest({ params: TemplateIdParamsSchema, body: ApproveTemplateBodySchema }) },
    async (request, reply) => {
      await notificationTemplateService.approveTemplate(
        request.params.templateId,
        request.body.approvedBy,
      );
      return reply.code(200).send({ message: "Template approved" });
    },
  );

  // Archive template
  server.post<{ Params: { templateId: string } }>(
    "/:templateId/archive",
    { preHandler: validateRequest({ params: TemplateIdParamsSchema }) },
    async (request, reply) => {
      await notificationTemplateService.archiveTemplate(
        request.params.templateId,
      );
      return reply.code(200).send({ message: "Template archived" });
    },
  );

  // Preview template
  server.post<{
    Params: { templateId: string };
    Body: { variables: Record<string, string> };
  }>("/:templateId/preview", { preHandler: validateRequest({ params: TemplateIdParamsSchema, body: PreviewTemplateBodySchema }) }, async (request, _reply) => {
    const preview = await notificationTemplateService.previewTemplate(
      request.params.templateId,
      request.body.variables,
    );
    return preview;
  });

  // Validate variables
  server.post("/validate", { preHandler: validateRequest({ body: ValidateTemplateBodySchema }) }, async (request, _reply) => {
    const { body, subject, variables } = request.body as any;
    const validation = notificationTemplateService.validateVariables(
      body,
      subject,
      variables,
    );
    return validation;
  });

  // Get all templates
  server.get("/", { preHandler: validateRequest({ query: ListTemplatesQuerySchema }) }, async (request, _reply) => {
    const filters = request.query as any;
    const templates =
      await notificationTemplateService.getAllTemplates(filters);
    return { templates, total: templates.length };
  });

  // Get template versions
  server.get<{ Params: { templateId: string } }>(
    "/:templateId/versions",
    { preHandler: validateRequest({ params: TemplateIdParamsSchema }) },
    async (request, _reply) => {
      const versions = await notificationTemplateService.getTemplateVersions(
        request.params.templateId,
      );
      return { versions, total: versions.length };
    },
  );
}
