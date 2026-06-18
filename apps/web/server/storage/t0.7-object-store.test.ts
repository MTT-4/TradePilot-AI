import { beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/server/db/prisma";
import {
  buildTenantObjectKey,
  ensureObjectStoreBucket,
  getTenantObjectBuffer,
  headTenantObject,
  putTenantObject,
} from "@/server/storage/object-store";

const prisma = getPrismaClient();

let tenantIdA = "";

beforeAll(async () => {
  const tenant = await prisma.tenant.findUnique({
    where: {
      slug: "shenghai-machinery",
    },
    select: {
      id: true,
    },
  });

  if (!tenant) {
    throw new Error(
      "Seed data missing. Run `npm run prisma:seed` before T0.7 storage tests.",
    );
  }

  tenantIdA = tenant.id;
});

describe("T0.7 object store", () => {
  it("stores and reads tenant-scoped objects through MinIO/S3", async () => {
    const objectKey = `jobs/demo-${Date.now()}.txt`;
    const body = "tradepilot object storage smoke test";

    await ensureObjectStoreBucket();

    const uploaded = await putTenantObject({
      tenantId: tenantIdA,
      objectKey,
      body,
      contentType: "text/plain",
    });

    expect(uploaded.key).toBe(buildTenantObjectKey(tenantIdA, objectKey));

    const head = await headTenantObject({
      tenantId: tenantIdA,
      objectKey,
    });
    expect(head.contentLength).toBe(Buffer.byteLength(body));
    expect(head.contentType).toBe("text/plain");

    const downloaded = await getTenantObjectBuffer({
      tenantId: tenantIdA,
      objectKey,
    });
    expect(downloaded.toString("utf8")).toBe(body);
  });
});
