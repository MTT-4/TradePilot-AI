import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getEnv } from "@/lib/env";

let objectStoreClientSingleton: S3Client | null = null;

function streamToBuffer(stream: unknown): Promise<Buffer> {
  if (
    !stream ||
    typeof stream !== "object" ||
    !("transformToByteArray" in stream)
  ) {
    throw new Error("Unsupported S3 response stream.");
  }

  return (stream as { transformToByteArray: () => Promise<Uint8Array> })
    .transformToByteArray()
    .then((bytes) => Buffer.from(bytes));
}

export function getObjectStoreClient() {
  if (!objectStoreClientSingleton) {
    const env = getEnv();

    objectStoreClientSingleton = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }

  return objectStoreClientSingleton;
}

export function buildTenantObjectKey(tenantId: string, objectKey: string) {
  const normalizedKey = objectKey.replace(/^\/+/, "");

  return `tenants/${tenantId}/${normalizedKey}`;
}

export async function ensureObjectStoreBucket() {
  const env = getEnv();
  const client = getObjectStoreClient();

  try {
    await client.send(
      new HeadBucketCommand({
        Bucket: env.S3_BUCKET,
      }),
    );
  } catch {
    await client.send(
      new CreateBucketCommand({
        Bucket: env.S3_BUCKET,
      }),
    );
  }
}

export async function putTenantObject(params: {
  tenantId: string;
  objectKey: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}) {
  const env = getEnv();
  const client = getObjectStoreClient();
  const key = buildTenantObjectKey(params.tenantId, params.objectKey);

  await ensureObjectStoreBucket();

  const response = await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );

  return {
    bucket: env.S3_BUCKET,
    key,
    etag: response.ETag ?? null,
  };
}

export async function getTenantObjectBuffer(params: {
  tenantId: string;
  objectKey: string;
}) {
  const env = getEnv();
  const client = getObjectStoreClient();
  const key = buildTenantObjectKey(params.tenantId, params.objectKey);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );

  return streamToBuffer(response.Body);
}

export async function headTenantObject(params: {
  tenantId: string;
  objectKey: string;
}) {
  const env = getEnv();
  const client = getObjectStoreClient();
  const key = buildTenantObjectKey(params.tenantId, params.objectKey);
  const response = await client.send(
    new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    }),
  );

  return {
    bucket: env.S3_BUCKET,
    key,
    contentLength: response.ContentLength ?? 0,
    contentType: response.ContentType ?? null,
    etag: response.ETag ?? null,
  };
}
