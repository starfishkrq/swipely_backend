import { Job } from "bullmq";
import { PriceService } from "../services/price.service.js";
import { logger } from "../utils/logger.js";
import { SUPPORTED_ASSETS } from "../config/index.js";

const priceService = new PriceService();

export async function processPriceCollection(job: Job) {
  logger.info({ jobId: job.id }, "Starting price collection job");

  for (const asset of SUPPORTED_ASSETS) {
    try {
      const aggregated = await priceService.getAggregatedPrice(asset.code);
      const staleSources = aggregated?.sources.filter((s) => s.stale) ?? [];
      if (staleSources.length > 0) {
        logger.warn(
          {
            asset: asset.code,
            staleSources: staleSources.map((s) => s.source),
          },
          "Price collection used cached/last-known-good provider values"
        );
      }
      logger.debug({ asset: asset.code }, "Fetched aggregated price");
    } catch (error) {
      logger.error({ asset: asset.code, error }, "Failed to fetch aggregated price in background job");
    }
  }
}
