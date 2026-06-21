import os from "node:os";
import path from "node:path";
import { MembershipRole } from "@prisma/client";
import { auth } from "@/auth";
import { getEnv } from "@/lib/env";
import { ApiError, routeErrorToResponse } from "@/server/api/errors";
import { requireTenantAccess } from "@/server/auth/access";
import { scanLocalModels } from "@/server/model-gateway/local-models";

export const GET = auth(async (request) => {
  try {
    const userId = request.auth?.user?.id;

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Login required.");
    }

    await requireTenantAccess(
      request.headers,
      userId,
      MembershipRole.ADMIN,
    );

    const env = getEnv();
    const baseDir =
      env.LOCAL_MODELS_DIR ?? path.join(os.homedir(), "AI", "models");
    const items = await scanLocalModels(baseDir, {
      maxDepth: 2,
    });

    return Response.json({
      baseDirLabel:
        baseDir.startsWith(os.homedir())
          ? `~/${path.relative(os.homedir(), baseDir)}`
          : path.basename(baseDir),
      items: items.map((item) => ({
        fileName: item.fileName,
        relativePath: path.relative(baseDir, item.filePath) || item.fileName,
        sizeBytes: item.sizeBytes,
        kind: item.kind,
        suggestedAlias: item.suggestedAlias,
      })),
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
});
