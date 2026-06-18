import { closeJobWorker, startJobWorker } from "@/server/jobs/worker";

async function main() {
  const worker = startJobWorker();
  await worker.waitUntilReady();
  console.log("[tradepilot] job worker ready");

  const shutdown = async () => {
    console.log("[tradepilot] shutting down job worker");
    await closeJobWorker();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[tradepilot] job worker failed", error);
  process.exit(1);
});
