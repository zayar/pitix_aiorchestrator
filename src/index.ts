import { createServer } from "./server.js";
import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
});

const app = createServer();

app.listen(config.port, () => {
  logger.info("ai-orchestrator-pitix listening", {
    port: config.port,
    sttProvider: config.sttProvider,
    llmProvider: config.llmProvider,
  });
});

