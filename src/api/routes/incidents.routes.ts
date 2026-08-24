import type { FastifyInstance } from "fastify";
import { IncidentService, type IncidentSeverity, type IncidentStatus } from "../../services/incident.service.js";
import { IncidentIngestionService, type RawIncidentPayload } from "../../services/incidentIngestion.service.js";
import { validateRequest } from "../middleware/validation.js";
import {
  ListIncidentsQuerySchema,
  IncidentIdParamsSchema,
  CreateIncidentBodySchema,
  IngestIncidentBodySchema,
  UpdateIncidentStatusBodySchema,
  MarkIncidentReadBodySchema,
  UnreadCountQuerySchema,
  ReviewQueueQuerySchema,
} from "../validations/incidents.schema.js";

const incidentService = new IncidentService();
const incidentIngestionService = new IncidentIngestionService();

const SEVERITY_VALUES: IncidentSeverity[] = ["critical", "high", "medium", "low"];
const STATUS_VALUES: IncidentStatus[] = ["open", "investigating", "resolved"];

export async function incidentRoutes(server: FastifyInstance) {
  // GET /api/v1/incidents — list with optional filters
  server.get<{
    Querystring: {
      bridgeId?: string;
      assetCode?: string;
      severity?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/",
    {
      preHandler: validateRequest({ query: ListIncidentsQuerySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "List bridge incidents",
        querystring: {
          type: "object",
          properties: {
            bridgeId: { type: "string" },
            assetCode: { type: "string" },
            severity: { type: "string", enum: SEVERITY_VALUES },
            status: { type: "string", enum: STATUS_VALUES },
            limit: { type: "string" },
            offset: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, _reply) => {
      const { bridgeId, assetCode, severity, status, limit, offset } = request.query;
      return incidentService.listIncidents({
        bridgeId,
        assetCode,
        severity: severity as IncidentSeverity | undefined,
        status: status as IncidentStatus | undefined,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
    }
  );

  // GET /api/v1/incidents/:id/replay — ordered event timeline for replay player
  server.get<{ Params: { id: string } }>(
    "/:id/replay",
    {
      preHandler: validateRequest({ params: IncidentIdParamsSchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Get incident replay timeline",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const timeline = await incidentService.getIncidentReplayTimeline(request.params.id);
      if (!timeline) return reply.status(404).send({ error: "Incident not found" });
      return timeline;
    }
  );

  // GET /api/v1/incidents/:id — get single incident
  server.get<{ Params: { id: string } }>(
    "/:id",
    {
      preHandler: validateRequest({ params: IncidentIdParamsSchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Get a bridge incident by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const incident = await incidentService.getIncident(request.params.id);
      if (!incident) return reply.status(404).send({ error: "Incident not found" });
      return incident;
    }
  );

  // POST /api/v1/incidents — create an incident
  server.post<{
    Body: {
      bridgeId: string;
      assetCode?: string;
      severity: IncidentSeverity;
      title: string;
      description: string;
      sourceUrl?: string;
      sourceType?: string;
      sourceExternalId?: string;
      sourceRepository?: string;
      sourceRepoAvatarUrl?: string;
      sourceActor?: string;
      sourceAttribution?: Record<string, unknown>;
      followUpActions?: string[];
      occurredAt?: string;
    };
  }>(
    "/",
    {
      preHandler: validateRequest({ body: CreateIncidentBodySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Create a bridge incident",
        body: {
          type: "object",
          required: ["bridgeId", "severity", "title", "description"],
          properties: {
            bridgeId: { type: "string" },
            assetCode: { type: "string" },
            severity: { type: "string", enum: SEVERITY_VALUES },
            title: { type: "string" },
            description: { type: "string" },
            sourceUrl: { type: "string" },
            sourceType: { type: "string" },
            sourceExternalId: { type: "string" },
            sourceRepository: { type: "string" },
            sourceRepoAvatarUrl: { type: "string" },
            sourceActor: { type: "string" },
            sourceAttribution: { type: "object", additionalProperties: true },
            followUpActions: { type: "array", items: { type: "string" } },
            occurredAt: { type: "string" },
          },
        },
        response: {
          201: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const incident = await incidentService.createIncident(request.body);
      return reply.status(201).send(incident);
    }
  );

  // POST /api/v1/incidents/ingest — normalize and ingest an external incident payload
  server.post<{ Body: RawIncidentPayload }>(
    "/ingest",
    {
      preHandler: validateRequest({ body: IngestIncidentBodySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Ingest incident payload from external source",
        body: {
          type: "object",
          properties: {
            sourceType: { type: "string" },
            externalId: { type: "string" },
            bridgeId: { type: "string" },
            assetCode: { type: "string" },
            severity: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            sourceUrl: { type: "string" },
            occurredAt: { type: "string" },
            repository: { type: "string" },
            repoAvatarUrl: { type: "string" },
            actor: { type: "string" },
            followUpActions: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
            source: {
              type: "object",
              additionalProperties: true,
              properties: {
                type: { type: "string" },
                externalId: { type: "string" },
                repository: { type: "string" },
                repoAvatarUrl: { type: "string" },
                actor: { type: "string" },
                url: { type: "string" },
              },
            },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const result = await incidentIngestionService.ingestWithRetry(request.body);
      if (result.queuedForReview) {
        return reply.status(202).send(result);
      }
      return result;
    }
  );

  // POST /api/v1/incidents/webhook — webhook-friendly alias for external integrations
  server.post<{ Body: RawIncidentPayload }>(
    "/webhook",
    {
      schema: {
        tags: ["Incidents"],
        summary: "Webhook ingestion endpoint for bridge incidents",
        body: { type: "object", additionalProperties: true },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, reply) => {
      const result = await incidentIngestionService.ingestWithRetry(request.body);
      if (result.queuedForReview) {
        return reply.status(202).send(result);
      }
      return result;
    }
  );

  // GET /api/v1/incidents/ingestion/review-queue — list pending manual review payloads
  server.get<{ Querystring: { limit?: string } }>(
    "/ingestion/review-queue",
    {
      preHandler: validateRequest({ query: ReviewQueueQuerySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "List pending incident ingestion review queue",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, _reply) => {
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const items = await incidentIngestionService.listManualReviewQueue(limit);
      return { items, total: items.length };
    }
  );

  // PATCH /api/v1/incidents/:id/status — update status
  server.patch<{ Params: { id: string }; Body: { status: IncidentStatus } }>(
    "/:id/status",
    {
      preHandler: validateRequest({ params: IncidentIdParamsSchema, body: UpdateIncidentStatusBodySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Update incident status",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: STATUS_VALUES } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { $ref: "Error#" },
        },
      },
    },
    async (request, reply) => {
      const updated = await incidentService.updateIncidentStatus(request.params.id, request.body.status);
      if (!updated) return reply.status(404).send({ error: "Incident not found" });
      return updated;
    }
  );

  // POST /api/v1/incidents/:id/read — mark as read for a session
  server.post<{ Params: { id: string }; Body: { userSession: string } }>(
    "/:id/read",
    {
      preHandler: validateRequest({ params: IncidentIdParamsSchema, body: MarkIncidentReadBodySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Mark an incident as read",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          required: ["userSession"],
          properties: { userSession: { type: "string" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, _reply) => {
      await incidentService.markRead(request.params.id, request.body.userSession);
      return { ok: true };
    }
  );

  // GET /api/v1/incidents/unread/count?userSession=xxx
  server.get<{ Querystring: { userSession: string } }>(
    "/unread/count",
    {
      preHandler: validateRequest({ query: UnreadCountQuerySchema }),
      schema: {
        tags: ["Incidents"],
        summary: "Get unread incident count for a session",
        querystring: {
          type: "object",
          required: ["userSession"],
          properties: { userSession: { type: "string" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request, _reply) => {
      const count = await incidentService.getUnreadCount(request.query.userSession);
      return { count };
    }
  );
}
