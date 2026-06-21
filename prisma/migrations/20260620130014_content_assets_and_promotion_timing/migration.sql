-- CreateEnum
CREATE TYPE "ContentAssetKind" AS ENUM ('reference', 'product', 'brand', 'document');

-- DropIndex
DROP INDEX "knowledge_chunks_embedding_hnsw_idx";

-- CreateTable
CREATE TABLE "content_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "kind" "ContentAssetKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_assets_tenant_id_idx" ON "content_assets"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_assets_tenant_id_object_key_key" ON "content_assets"("tenant_id", "object_key");

-- Re-create existing vector index that Prisma cannot model declaratively.
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx"
ON "knowledge_chunks"
USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
