import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  alertRulesService,
  type AlertRuleStatus,
  type LogicOperator,
  type RulePriority,
  type RuleCondition,
  type TimeWindow,
} from "../../services/alertRules.service.js";
import { validateRequest } from "../middleware/validation.js";
import {
  CreateAlertRuleBodySchema,
  UpdateAlertRuleBodySchema,
  SetAlertRuleStatusBodySchema,
  TestAlertRuleBodySchema,
  EvaluateAlertRulesBodySchema,
  AlertRuleIdParamsSchema,
  ListAlertRulesQuerySchema,
} from "../validations/alertRules.schema.js";

// =============================================================================
// TYPES
// =============================================================================

interface RuleParams { id: string }

interface CreateRuleBody {
  ownerAddress: string;
  name: string;
  description?: string;
  assetCode: string;
  conditions: RuleCondition[];
  logicOperator?: LogicOperator;
  priority?: RulePriority;
  cooldownSeconds?: number;
  timeWindow?: TimeWindow;
  webhookUrl?: string;
  templateId?: string;
  status?: AlertRuleStatus;
}

interface UpdateRuleBody {
  changedBy: string;
  name?: string;
  description?: string;
  conditions?: RuleCondition[];
  logicOperator?: LogicOperator;
  priority?: RulePriority;
  status?: AlertRuleStatus;
  cooldownSeconds?: number;
  timeWindow?: TimeWindow | null;
  webhookUrl?: string | null;
}

interface ListRulesQuery {
  ownerAddress?: string;
  assetCode?: string;
  status?: AlertRuleStatus;
  priority?: RulePriority;
}

interface TestRuleBody {
  metrics: Record<string, number>;
  previousMetrics?: Record<string, number>;
}

interface EvaluateBody {
  assetCode: string;
  metrics: Record<string, number>;
  previousMetrics?: Record<string, number>;
}

// =============================================================================
// ROUTES
// =============================================================================

export async function alertRulesRoutes(server: FastifyInstance) {

  // ---------------------------------------------------------------------------
  // TEMPLATES
  // ---------------------------------------------------------------------------

  server.get("/templates", async () => alertRulesService.listTemplates());

  server.get<{ Params: { templateId: string } }>(
    "/templates/:templateId",
    async (request: FastifyRequest<{ Params: { templateId: string } }>, reply: FastifyReply) => {
      const tpl = alertRulesService.getTemplate(request.params.templateId);
      if (!tpl) return reply.code(404).send({ error: "Template not found" });
      return tpl;
    }
  );

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  server.post<{ Body: CreateRuleBody }>(
    "/",
    { preHandler: validateRequest({ body: CreateAlertRuleBodySchema }) },
    async (request: FastifyRequest<{ Body: CreateRuleBody }>, reply: FastifyReply) => {
      try {
        const rule = await alertRulesService.createRule(request.body);
        return reply.code(201).send(rule);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create rule";
        return reply.code(400).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // LIST
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: ListRulesQuery }>(
    "/",
    { preHandler: validateRequest({ query: ListAlertRulesQuerySchema }) },
    async (request: FastifyRequest<{ Querystring: ListRulesQuery }>) =>
      alertRulesService.listRules(request.query)
  );

  // ---------------------------------------------------------------------------
  // GET
  // ---------------------------------------------------------------------------

  server.get<{ Params: RuleParams }>(
    "/:id",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema }) },
    async (request: FastifyRequest<{ Params: RuleParams }>, reply: FastifyReply) => {
      const rule = await alertRulesService.getRule(request.params.id);
      if (!rule) return reply.code(404).send({ error: "Rule not found" });
      return rule;
    }
  );

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  server.patch<{ Params: RuleParams; Body: UpdateRuleBody }>(
    "/:id",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema, body: UpdateAlertRuleBodySchema }) },
    async (request: FastifyRequest<{ Params: RuleParams; Body: UpdateRuleBody }>, reply: FastifyReply) => {
      try {
        const { changedBy, ...updates } = request.body;
        const rule = await alertRulesService.updateRule(request.params.id, changedBy ?? "api", updates);
        if (!rule) return reply.code(404).send({ error: "Rule not found" });
        return rule;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update rule";
        return reply.code(400).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // ENABLE / DISABLE / SET-STATUS
  // ---------------------------------------------------------------------------

  server.post<{ Params: RuleParams; Body: { status: AlertRuleStatus } }>(
    "/:id/status",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema, body: SetAlertRuleStatusBodySchema }) },
    async (
      request: FastifyRequest<{ Params: RuleParams; Body: { status: AlertRuleStatus } }>,
      reply: FastifyReply
    ) => {
      const ok = await alertRulesService.setStatus(request.params.id, request.body.status);
      if (!ok) return reply.code(404).send({ error: "Rule not found" });
      return { id: request.params.id, status: request.body.status };
    }
  );

  // ---------------------------------------------------------------------------
  // DELETE
  // ---------------------------------------------------------------------------

  server.delete<{ Params: RuleParams }>(
    "/:id",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema }) },
    async (request: FastifyRequest<{ Params: RuleParams }>, reply: FastifyReply) => {
      const deleted = await alertRulesService.deleteRule(request.params.id);
      if (!deleted) return reply.code(404).send({ error: "Rule not found" });
      return reply.code(204).send();
    }
  );

  // ---------------------------------------------------------------------------
  // VERSION HISTORY
  // ---------------------------------------------------------------------------

  server.get<{ Params: RuleParams }>(
    "/:id/versions",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema }) },
    async (request: FastifyRequest<{ Params: RuleParams }>, reply: FastifyReply) => {
      try {
        const history = await alertRulesService.getVersionHistory(request.params.id);
        return history;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get version history";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // TEST (dry-run evaluation)
  // ---------------------------------------------------------------------------

  server.post<{ Params: RuleParams; Body: TestRuleBody }>(
    "/:id/test",
    { preHandler: validateRequest({ params: AlertRuleIdParamsSchema, body: TestAlertRuleBodySchema }) },
    async (request: FastifyRequest<{ Params: RuleParams; Body: TestRuleBody }>, reply: FastifyReply) => {
      try {
        const result = await alertRulesService.testRule(
          request.params.id,
          request.body.metrics,
          request.body.previousMetrics
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to test rule";
        return reply.code(400).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // EVALUATE ALL ACTIVE RULES FOR AN ASSET
  // ---------------------------------------------------------------------------

  server.post<{ Body: EvaluateBody }>(
    "/evaluate",
    { preHandler: validateRequest({ body: EvaluateAlertRulesBodySchema }) },
    async (request: FastifyRequest<{ Body: EvaluateBody }>, reply: FastifyReply) => {
      try {
        const { assetCode, metrics, previousMetrics } = request.body;
        const results = await alertRulesService.evaluateAllActiveRules(
          assetCode,
          metrics,
          previousMetrics
        );
        return {
          assetCode,
          evaluatedAt: new Date().toISOString(),
          results,
          triggeredCount: results.filter((r) => r.triggered).length,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Evaluation failed";
        return reply.code(500).send({ error: message });
      }
    }
  );
}
