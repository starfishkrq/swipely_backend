import type { FastifyInstance } from "fastify";
import { TransactionService } from "../../services/transaction.service.js";
import { validateRequest } from "../middleware/validation.js";
import {
  TransactionsListQuerySchema,
  TransactionsExportQuerySchema,
  FetchTransactionsBodySchema,
  BackfillTransactionsBodySchema,
  DetectNewTransactionsBodySchema,
  TransactionSyncStateParamsSchema,
} from "../validations/transactions.schema.js";

export async function transactionsRoutes(server: FastifyInstance) {
  const transactionService = new TransactionService();

  server.get<{
    Querystring: {
      bridge?: string;
      asset?: string;
      status?: "pending" | "completed" | "failed";
      operationType?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    "/",
    {
      preHandler: validateRequest({ query: TransactionsListQuerySchema }),
      schema: {
        tags: ["Transactions"],
        summary: "List stored transactions",
        querystring: {
          type: "object",
          properties: {
            bridge: { type: "string" },
            asset: { type: "string" },
            status: { type: "string", enum: ["pending", "completed", "failed"] },
            operationType: { type: "string" },
            search: { type: "string" },
            dateFrom: { type: "string", format: "date-time" },
            dateTo: { type: "string", format: "date-time" },
            page: { type: "string", default: "1" },
            pageSize: { type: "string", default: "10" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              transactions: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "number" },
              page: { type: "number" },
              pageSize: { type: "number" },
              totalPages: { type: "number" },
            },
          },
        },
      },
    },
    async (request) => {
      const result = await transactionService.listTransactions(
        {
          bridge: request.query.bridge,
          asset: request.query.asset,
          status: request.query.status,
          operationType: request.query.operationType,
          search: request.query.search,
          dateFrom: request.query.dateFrom,
          dateTo: request.query.dateTo,
        },
        Number(request.query.page ?? "1"),
        Number(request.query.pageSize ?? "10"),
      );

      return result;
    },
  );

  server.get<{
    Querystring: {
      bridge?: string;
      asset?: string;
      status?: "pending" | "completed" | "failed";
      operationType?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      format?: string;
    };
  }>(
    "/export",
    {
      preHandler: validateRequest({ query: TransactionsExportQuerySchema }),
      schema: {
        tags: ["Transactions"],
        summary: "Export stored transactions as CSV",
        querystring: {
          type: "object",
          properties: {
            bridge: { type: "string" },
            asset: { type: "string" },
            status: { type: "string", enum: ["pending", "completed", "failed"] },
            operationType: { type: "string" },
            search: { type: "string" },
            dateFrom: { type: "string", format: "date-time" },
            dateTo: { type: "string", format: "date-time" },
            format: { type: "string", enum: ["csv"], default: "csv" },
          },
        },
      },
    },
    async (request, reply) => {
      const csv = await transactionService.exportTransactionsCsv({
        bridge: request.query.bridge,
        asset: request.query.asset,
        status: request.query.status,
        operationType: request.query.operationType,
        search: request.query.search,
        dateFrom: request.query.dateFrom,
        dateTo: request.query.dateTo,
      });

      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename=transactions-${Date.now()}.csv`);
      return reply.send(csv);
    },
  );

  server.post<{
    Body: {
      assetCode: string;
      assetIssuer: string;
      bridgeName?: string;
      cursor?: string;
      operationTypes?: string[];
      pageSize?: number;
      maxPages?: number;
    };
  }>(
    "/fetch",
    {
      preHandler: validateRequest({ body: FetchTransactionsBodySchema }),
      schema: {
        tags: ["Transactions"],
        summary: "Fetch latest transactions from Horizon for an asset",
        body: {
          type: "object",
          required: ["assetCode", "assetIssuer"],
          properties: {
            assetCode: { type: "string" },
            assetIssuer: { type: "string" },
            bridgeName: { type: "string" },
            cursor: { type: "string" },
            operationTypes: { type: "array", items: { type: "string" } },
            pageSize: { type: "number" },
            maxPages: { type: "number" },
          },
        },
      },
    },
    async (request) => {
      const result = await transactionService.fetchTransactionsByAsset(
        request.body.assetCode,
        request.body.assetIssuer,
        {
          bridgeName: request.body.bridgeName,
          cursor: request.body.cursor,
          operationTypes: request.body.operationTypes,
          pageSize: request.body.pageSize,
          maxPages: request.body.maxPages,
        },
      );

      return { success: true, ...result };
    },
  );

  server.post<{
    Body: {
      assetCode: string;
      assetIssuer: string;
      bridgeName?: string;
      cursor?: string;
      operationTypes?: string[];
      pages?: number;
    };
  }>(
    "/backfill",
    {
      preHandler: validateRequest({ body: BackfillTransactionsBodySchema }),
      schema: {
        tags: ["Transactions"],
        summary: "Backfill historical transactions for an asset",
        body: {
          type: "object",
          required: ["assetCode", "assetIssuer"],
          properties: {
            assetCode: { type: "string" },
            assetIssuer: { type: "string" },
            bridgeName: { type: "string" },
            cursor: { type: "string" },
            operationTypes: { type: "array", items: { type: "string" } },
            pages: { type: "number", default: 25 },
          },
        },
      },
    },
    async (request) => {
      const result = await transactionService.backfillAssetTransactions(
        request.body.assetCode,
        request.body.assetIssuer,
        {
          bridgeName: request.body.bridgeName,
          cursor: request.body.cursor,
          operationTypes: request.body.operationTypes,
          pages: request.body.pages,
        },
      );

      return { success: true, ...result };
    },
  );

  server.post<{
    Body: {
      assetCode: string;
      assetIssuer: string;
      operationTypes?: string[];
    };
  }>(
    "/detect-new",
    {
      preHandler: validateRequest({ body: DetectNewTransactionsBodySchema }),
      schema: {
        tags: ["Transactions"],
        summary: "Detect and store newly seen Horizon transactions",
        body: {
          type: "object",
          required: ["assetCode", "assetIssuer"],
          properties: {
            assetCode: { type: "string" },
            assetIssuer: { type: "string" },
            operationTypes: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request) => {
      const result = await transactionService.detectNewTransactions(
        request.body.assetCode,
        request.body.assetIssuer,
        request.body.operationTypes,
      );

      return { success: true, ...result };
    },
  );

  server.get<{
    Params: {
      assetCode: string;
      assetIssuer: string;
    };
  }>(
    "/sync-state/:assetCode/:assetIssuer",
    {
      preHandler: validateRequest({ params: TransactionSyncStateParamsSchema }),
      schema: {
        tags: ["Transactions"],
        summary: "Get transaction fetch sync cursor and error status",
        params: {
          type: "object",
          required: ["assetCode", "assetIssuer"],
          properties: {
            assetCode: { type: "string" },
            assetIssuer: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const state = await transactionService.getSyncState(
        request.params.assetCode,
        request.params.assetIssuer,
      );
      return { state };
    },
  );
}
