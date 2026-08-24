import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HealthService } from "../../services/health.service.js";
import { LiquidityService } from "../../services/liquidity.service.js";
import { PriceService } from "../../services/price.service.js";
import { assetTagService } from "../../services/assetTag.service.js";
import { authMiddleware } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  AssetSymbolParamsSchema,
  AssetHealthHistoryQuerySchema,
  CreateTagBodySchema,
  UpdateTagBodySchema,
  TagIdParamsSchema,
  BulkAssignTagsBodySchema,
  AssignTagsToAssetBodySchema,
  AssetTagParamsSchema,
} from "../validations/assets.schema.js";

function getAuditActorType(source: "api-key" | "bootstrap" | undefined): "user" | "api_key" | "system" {
  if (source === "api-key") return "api_key";
  if (source === "bootstrap") return "system";
  return "user";
}

export async function assetsRoutes(server: FastifyInstance) {
  const healthService = new HealthService();
  const liquidityService = new LiquidityService();
  const priceService = new PriceService();

  // List all monitored assets
  server.get(
    "/",
    {
      schema: {
        tags: ["Assets"],
        summary: "List all monitored assets",
        description: "Returns every asset currently tracked by Bridge-Watch.",
        response: {
          200: {
            type: "object",
            properties: {
              assets: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer", example: 0 },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return { assets: [], total: 0 };
    },
  );

  // Get detailed asset information
  server.get<{ Params: { symbol: string } }>(
    "/:symbol",
    {
      preHandler: validateRequest({ params: AssetSymbolParamsSchema }),
      schema: {
        tags: ["Assets"],
        summary: "Get asset details",
        params: {
          type: "object",
          properties: { symbol: { type: "string", description: "Asset symbol, e.g. USDC", example: "USDC" } },
          required: ["symbol"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              details: { nullable: true, type: "object", additionalProperties: true },
            },
          },
          404: { $ref: "Error#" },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply,
    ) => {
      const { symbol } = request.params;
      return { symbol, details: null };
    },
  );

  // Get current health score for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/health",
    {
      preHandler: validateRequest({ params: AssetSymbolParamsSchema }),
      schema: {
        tags: ["Assets"],
        summary: "Get current health score",
        description: "Returns the most recent health score for the specified asset.",
        params: {
          type: "object",
          properties: { symbol: { type: "string", example: "USDC" } },
          required: ["symbol"],
        },
        response: {
          200: { $ref: "HealthScore#" },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply,
    ) => {
      const { symbol } = request.params;
      const health = await healthService.getHealthScore(symbol);
      return health;
    },
  );

  // Get historical health scores for sparklines
  server.get<{
    Params: { symbol: string };
    Querystring: { period?: "24h" | "7d" | "30d" };
  }>(
    "/:symbol/health/history",
    {
      preHandler: validateRequest({
        params: AssetSymbolParamsSchema,
        query: AssetHealthHistoryQuerySchema,
      }),
      schema: {
        tags: ["Assets"],
        summary: "Get health score history",
        description: "Returns time-series health score data for sparkline rendering.",
        params: {
          type: "object",
          properties: { symbol: { type: "string", example: "USDC" } },
          required: ["symbol"],
        },
        querystring: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["24h", "7d", "30d"],
              default: "7d",
              description: "Time window for history",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              period: { type: "string" },
              points: { type: "array", items: { type: "object", additionalProperties: true } },
            },
          },
          400: { $ref: "Error#" },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { symbol: string };
        Querystring: { period?: "24h" | "7d" | "30d" };
      }>,
      reply: FastifyReply,
    ) => {
      const { symbol } = request.params;
      const period = request.query.period ?? "7d";
      const days = period === "24h" ? 1 : period === "30d" ? 30 : 7;

      if (!symbol) {
        return reply.status(400).send({ error: "Missing symbol" });
      }

      const points = await healthService.getHealthHistory(symbol, days);
      return { symbol, period, points };
    },
  );

  // Get aggregated liquidity data for an asset
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/liquidity",
    {
      preHandler: validateRequest({ params: AssetSymbolParamsSchema }),
      schema: {
        tags: ["Assets"],
        summary: "Get aggregated liquidity",
        params: {
          type: "object",
          properties: { symbol: { type: "string", example: "USDC" } },
          required: ["symbol"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply,
    ) => {
      const { symbol } = request.params;
      const liquidity = await liquidityService.getAggregatedLiquidity(symbol);
      return liquidity;
    },
  );

  // Get current price from all sources
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/price",
    {
      preHandler: validateRequest({ params: AssetSymbolParamsSchema }),
      schema: {
        tags: ["Assets"],
        summary: "Get aggregated price",
        description: "Returns the current price aggregated across all tracked sources.",
        params: {
          type: "object",
          properties: { symbol: { type: "string", example: "USDC" } },
          required: ["symbol"],
        },
        response: {
          200: { type: "object", additionalProperties: true },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { symbol: string } }>,
      _reply: FastifyReply,
    ) => {
      const { symbol } = request.params;
      const price = await priceService.getAggregatedPrice(symbol);
      return price;
    },
  );

  // List all asset tags
  server.get(
    "/tags",
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const tags = await assetTagService.getAllTags();
      return { tags };
    }
  );

  // Get tag details
  server.get<{ Params: { id: string } }>(
    "/tags/:id",
    {
      preHandler: validateRequest({ params: TagIdParamsSchema }),
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const tag = await assetTagService.getTagById(id);
      if (!tag) {
        return reply.status(404).send({ error: "Tag not found" });
      }
      return tag;
    }
  );

  // Create an asset tag
  server.post<{ Body: { name: string; color?: string | null } }>(
    "/tags",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ body: CreateTagBodySchema })],
    },
    async (request: FastifyRequest<{ Body: { name: string; color?: string | null } }>, reply: FastifyReply) => {
      try {
        const { name, color } = request.body;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);
        const tag = await assetTagService.createTag(name, color || null, performedBy, actorType);
        return reply.status(201).send(tag);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create tag";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Update an asset tag
  server.put<{ Params: { id: string }; Body: { name?: string; color?: string | null } }>(
    "/tags/:id",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ params: TagIdParamsSchema, body: UpdateTagBodySchema })],
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; color?: string | null } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);
        const tag = await assetTagService.updateTag(id, request.body, performedBy, actorType);
        return tag;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update tag";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Delete an asset tag
  server.delete<{ Params: { id: string } }>(
    "/tags/:id",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ params: TagIdParamsSchema })],
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);
        await assetTagService.deleteTag(id, performedBy, actorType);
        return reply.status(200).send({ success: true, message: "Tag deleted successfully" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete tag";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Bulk assign tags to assets
  server.post<{ Body: { assetSymbols: string[]; tagNames: string[] } }>(
    "/tags/bulk-assign",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ body: BulkAssignTagsBodySchema })],
    },
    async (request: FastifyRequest<{ Body: { assetSymbols: string[]; tagNames: string[] } }>, reply: FastifyReply) => {
      try {
        const { assetSymbols, tagNames } = request.body;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);
        const result = await assetTagService.bulkAssignTags(assetSymbols, tagNames, performedBy, actorType);
        return reply.status(200).send({ success: true, ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to bulk assign tags";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Get tags for an asset symbol
  server.get<{ Params: { symbol: string } }>(
    "/:symbol/tags",
    {
      preHandler: validateRequest({ params: AssetSymbolParamsSchema }),
    },
    async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const tags = await assetTagService.getTagsForAsset(symbol);
        return { symbol, tags };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get tags for asset";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Assign tags to an asset symbol
  server.post<{ Params: { symbol: string }; Body: { tags: string[] } }>(
    "/:symbol/tags",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ params: AssetSymbolParamsSchema, body: AssignTagsToAssetBodySchema })],
    },
    async (request: FastifyRequest<{ Params: { symbol: string }; Body: { tags: string[] } }>, reply: FastifyReply) => {
      try {
        const { symbol } = request.params;
        const { tags } = request.body;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);

        for (const tagName of tags) {
          await assetTagService.assignTagToAsset(symbol, tagName, performedBy, actorType);
        }

        const currentTags = await assetTagService.getTagsForAsset(symbol);
        return reply.status(200).send({ success: true, tags: currentTags });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to assign tags";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // Unassign a tag from an asset symbol
  server.delete<{ Params: { symbol: string; tagName: string } }>(
    "/:symbol/tags/:tagName",
    {
      preHandler: [authMiddleware({ requiredScopes: ["assets:write"] }), validateRequest({ params: AssetTagParamsSchema })],
    },
    async (request: FastifyRequest<{ Params: { symbol: string; tagName: string } }>, reply: FastifyReply) => {
      try {
        const { symbol, tagName } = request.params;
        const performedBy = request.apiKeyAuth?.name || "system";
        const actorType = getAuditActorType(request.apiKeyAuth?.source);

        await assetTagService.unassignTagFromAsset(symbol, tagName, performedBy, actorType);
        return reply.status(200).send({ success: true, message: `Tag "${tagName}" unassigned from asset "${symbol}"` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to unassign tag";
        return reply.status(400).send({ error: message });
      }
    }
  );
}
