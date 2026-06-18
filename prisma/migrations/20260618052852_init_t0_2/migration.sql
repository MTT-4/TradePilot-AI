-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "LocaleCode" AS ENUM ('en', 'ar', 'ru', 'fr', 'de', 'pt', 'zh');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'operator', 'sales', 'viewer');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "FileSourceType" AS ENUM ('upload', 'url', 'generated', 'email_attachment');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('document', 'image', 'export', 'other');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('uploaded', 'parsing', 'chunking', 'embedding', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "KnowledgeSensitivity" AS ENUM ('public', 'internal_only');

-- CreateEnum
CREATE TYPE "KnowledgeReviewStatus" AS ENUM ('pending', 'approved', 'corrected');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('parse_document', 'embed_document', 'generate_site', 'translate_site', 'generate_content_pack', 'generate_reply', 'import_inbound_email');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'retrying');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('draft', 'published', 'offline');

-- CreateEnum
CREATE TYPE "LocaleDirection" AS ENUM ('ltr', 'rtl');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('pending', 'published', 'failed', 'offline');

-- CreateEnum
CREATE TYPE "ContentPackStatus" AS ENUM ('draft', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('image', 'carousel', 'video_script');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('linkedin', 'facebook', 'instagram', 'reels', 'tiktok', 'youtube', 'shorts', 'vk_clips', 'rutube');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'following', 'won', 'lost');

-- CreateEnum
CREATE TYPE "LeadScore" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "InquirySourceType" AS ENUM ('form', 'email');

-- CreateEnum
CREATE TYPE "InboundEmailStatus" AS ENUM ('received', 'processed', 'spam', 'failed');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('new', 'contacted', 'quoted', 'won', 'lost');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('note', 'stage_change', 'follow_up', 'email', 'reply_sent');

-- CreateEnum
CREATE TYPE "ReplyStatus" AS ENUM ('draft', 'pending_approval', 'sent', 'rejected');

-- CreateEnum
CREATE TYPE "HitlTaskType" AS ENUM ('site_publish', 'content_publish', 'reply_send');

-- CreateEnum
CREATE TYPE "HitlStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('hitl_pending', 'lead_new', 'follow_up', 'job_failed', 'system');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('unread', 'read');

-- CreateEnum
CREATE TYPE "ModelRoute" AS ENUM ('openai', 'google_translate', 'local_qwen', 'local_bge');

-- CreateEnum
CREATE TYPE "ModelTaskType" AS ENUM ('generate', 'translate', 'embed', 'classify');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('export', 'delete');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('pending', 'processing', 'completed', 'rejected');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "default_locale" "LocaleCode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_rules" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "display_name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "primary_color" TEXT,
    "secondary_color" TEXT,
    "logo_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT,
    "source_type" "FileSourceType" NOT NULL,
    "kind" "FileKind" NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "checksum" TEXT,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "idempotency_key" TEXT,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_invocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "route" "ModelRoute" NOT NULL,
    "task_type" "ModelTaskType" NOT NULL,
    "model_name" TEXT NOT NULL,
    "contains_pii" BOOLEAN NOT NULL DEFAULT false,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "latency_ms" INTEGER,
    "cost_usd" DECIMAL(12,4),
    "reason" TEXT,
    "request_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "model_invocation_id" TEXT,
    "user_id" TEXT,
    "delta_credits" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_id" TEXT,
    "uploaded_by_user_id" TEXT,
    "title" TEXT NOT NULL,
    "source_type" "FileSourceType" NOT NULL,
    "source_url" TEXT,
    "status" "KnowledgeDocumentStatus" NOT NULL,
    "sensitivity" "KnowledgeSensitivity" NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "product" TEXT,
    "market" TEXT,
    "source_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "namespace" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_citation" TEXT,
    "locale" "LocaleCode" NOT NULL,
    "product" TEXT,
    "market" TEXT,
    "sensitivity" "KnowledgeSensitivity" NOT NULL,
    "metadata" JSONB,
    "embedding" vector(1024),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_reviews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_id" TEXT,
    "reviewed_by_user_id" TEXT,
    "question" TEXT,
    "answer" TEXT,
    "corrected_text" TEXT,
    "source_citation" TEXT,
    "sensitivity" "KnowledgeSensitivity" NOT NULL,
    "status" "KnowledgeReviewStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_qa_pairs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT,
    "created_by_user_id" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sensitivity" "KnowledgeSensitivity" NOT NULL,
    "status" "KnowledgeReviewStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_qa_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_projects" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "current_version_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "market" TEXT,
    "product" TEXT,
    "style" TEXT,
    "cta" TEXT,
    "default_locale" "LocaleCode" NOT NULL,
    "status" "SiteStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "site_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_project_id" TEXT NOT NULL,
    "page_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "is_homepage" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_locales" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_project_id" TEXT NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "direction" "LocaleDirection" NOT NULL,
    "url_path" TEXT NOT NULL,
    "translated_content" JSONB NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "geo_metadata" JSONB,
    "publish_status" "PublishStatus" NOT NULL,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_locales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "site_project_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "version_number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "market" TEXT,
    "status" "CampaignStatus" NOT NULL,
    "budget_usd" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_packs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "created_by_user_id" TEXT,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "market" TEXT,
    "locales" JSONB NOT NULL,
    "status" "ContentPackStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "content_pack_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "platform" "Platform" NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "media_type" "MediaType" NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "spec" JSONB NOT NULL,
    "publish_status" "PublishStatus" NOT NULL,
    "planned_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "content_item_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "slug" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "utm_source" TEXT NOT NULL,
    "utm_medium" TEXT NOT NULL,
    "utm_campaign" TEXT NOT NULL,
    "utm_content" TEXT,
    "bot_filter_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "click_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tracking_link_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "content_item_id" TEXT,
    "platform" "Platform" NOT NULL,
    "visitor_ip" TEXT,
    "user_agent" TEXT,
    "referer" TEXT,
    "query_string" TEXT,
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_name" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "country" TEXT,
    "preferred_locale" "LocaleCode",
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "owner_user_id" TEXT,
    "campaign_id" TEXT,
    "source_content_item_id" TEXT,
    "tracking_link_id" TEXT,
    "company_name" TEXT,
    "country" TEXT,
    "preferred_locale" "LocaleCode",
    "status" "LeadStatus" NOT NULL,
    "score" "LeadScore",
    "score_reason" TEXT,
    "dedupe_hash" TEXT,
    "follow_up_due_at" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_contact_at" TIMESTAMP(3),
    "form_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "inbound_email_id" TEXT,
    "source_type" "InquirySourceType" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "from_email" TEXT,
    "from_name" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_emails" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "provider" TEXT NOT NULL,
    "external_message_id" TEXT,
    "idempotency_key" TEXT,
    "dedupe_hash" TEXT,
    "from_email" TEXT,
    "from_name" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "attachments" JSONB,
    "status" "InboundEmailStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "name" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL,
    "value_amount" DECIMAL(12,2),
    "currency" TEXT DEFAULT 'USD',
    "follow_up_due_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "opportunity_id" TEXT,
    "actor_user_id" TEXT,
    "type" "CrmActivityType" NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "model_invocation_id" TEXT,
    "status" "ReplyStatus" NOT NULL,
    "route" "ModelRoute" NOT NULL,
    "draft_text" TEXT NOT NULL,
    "final_text" TEXT,
    "citations" JSONB,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hitl_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "assignee_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "rejected_by_user_id" TEXT,
    "type" "HitlTaskType" NOT NULL,
    "status" "HitlStatus" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hitl_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'unread',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link_url" TEXT,
    "payload" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL,
    "scope" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_idx" ON "memberships"("tenant_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_rules_platform_key" ON "platform_rules"("platform");

-- CreateIndex
CREATE INDEX "brand_kits_tenant_id_idx" ON "brand_kits"("tenant_id");

-- CreateIndex
CREATE INDEX "files_tenant_id_idx" ON "files"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_tenant_id_object_key_key" ON "files"("tenant_id", "object_key");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_idx" ON "jobs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenant_id_idempotency_key_key" ON "jobs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "model_invocations_tenant_id_idx" ON "model_invocations"("tenant_id");

-- CreateIndex
CREATE INDEX "model_invocations_route_contains_pii_idx" ON "model_invocations"("route", "contains_pii");

-- CreateIndex
CREATE INDEX "credit_ledger_tenant_id_idx" ON "credit_ledger"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_idx" ON "knowledge_documents"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_sensitivity_idx" ON "knowledge_documents"("status", "sensitivity");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_idx" ON "knowledge_chunks"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_namespace_idx" ON "knowledge_chunks"("tenant_id", "namespace");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_reviews_tenant_id_idx" ON "knowledge_reviews"("tenant_id");

-- CreateIndex
CREATE INDEX "knowledge_reviews_status_idx" ON "knowledge_reviews"("status");

-- CreateIndex
CREATE INDEX "knowledge_qa_pairs_tenant_id_idx" ON "knowledge_qa_pairs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_projects_current_version_id_key" ON "site_projects"("current_version_id");

-- CreateIndex
CREATE INDEX "site_projects_tenant_id_idx" ON "site_projects"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_projects_tenant_id_slug_key" ON "site_projects"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "site_pages_tenant_id_idx" ON "site_pages"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_site_project_id_slug_key" ON "site_pages"("site_project_id", "slug");

-- CreateIndex
CREATE INDEX "site_locales_tenant_id_idx" ON "site_locales"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_locales_site_project_id_locale_key" ON "site_locales"("site_project_id", "locale");

-- CreateIndex
CREATE INDEX "site_versions_tenant_id_idx" ON "site_versions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_versions_site_project_id_version_number_key" ON "site_versions"("site_project_id", "version_number");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_idx" ON "campaigns"("tenant_id");

-- CreateIndex
CREATE INDEX "content_packs_tenant_id_idx" ON "content_packs"("tenant_id");

-- CreateIndex
CREATE INDEX "content_items_tenant_id_idx" ON "content_items"("tenant_id");

-- CreateIndex
CREATE INDEX "content_items_platform_publish_status_idx" ON "content_items"("platform", "publish_status");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_content_item_id_key" ON "tracking_links"("content_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_slug_key" ON "tracking_links"("slug");

-- CreateIndex
CREATE INDEX "tracking_links_tenant_id_idx" ON "tracking_links"("tenant_id");

-- CreateIndex
CREATE INDEX "click_events_tenant_id_idx" ON "click_events"("tenant_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_idx" ON "contacts"("tenant_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_idx" ON "leads"("tenant_id");

-- CreateIndex
CREATE INDEX "leads_owner_user_id_idx" ON "leads"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_inbound_email_id_key" ON "inquiries"("inbound_email_id");

-- CreateIndex
CREATE INDEX "inquiries_tenant_id_idx" ON "inquiries"("tenant_id");

-- CreateIndex
CREATE INDEX "inbound_emails_tenant_id_idx" ON "inbound_emails"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_emails_tenant_id_idempotency_key_key" ON "inbound_emails"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_idx" ON "opportunities"("tenant_id");

-- CreateIndex
CREATE INDEX "crm_activities_tenant_id_idx" ON "crm_activities"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "replies_model_invocation_id_key" ON "replies"("model_invocation_id");

-- CreateIndex
CREATE INDEX "replies_tenant_id_idx" ON "replies"("tenant_id");

-- CreateIndex
CREATE INDEX "hitl_tasks_tenant_id_idx" ON "hitl_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "hitl_tasks_status_type_idx" ON "hitl_tasks"("status", "type");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_idx" ON "notifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "data_requests_tenant_id_idx" ON "data_requests"("tenant_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_invocations" ADD CONSTRAINT "model_invocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_model_invocation_id_fkey" FOREIGN KEY ("model_invocation_id") REFERENCES "model_invocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_reviews" ADD CONSTRAINT "knowledge_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_qa_pairs" ADD CONSTRAINT "knowledge_qa_pairs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_qa_pairs" ADD CONSTRAINT "knowledge_qa_pairs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_qa_pairs" ADD CONSTRAINT "knowledge_qa_pairs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_projects" ADD CONSTRAINT "site_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_projects" ADD CONSTRAINT "site_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_projects" ADD CONSTRAINT "site_projects_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "site_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_site_project_id_fkey" FOREIGN KEY ("site_project_id") REFERENCES "site_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_locales" ADD CONSTRAINT "site_locales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_locales" ADD CONSTRAINT "site_locales_site_project_id_fkey" FOREIGN KEY ("site_project_id") REFERENCES "site_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_project_id_fkey" FOREIGN KEY ("site_project_id") REFERENCES "site_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_content_item_id_fkey" FOREIGN KEY ("source_content_item_id") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_inbound_email_id_fkey" FOREIGN KEY ("inbound_email_id") REFERENCES "inbound_emails"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_model_invocation_id_fkey" FOREIGN KEY ("model_invocation_id") REFERENCES "model_invocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_tasks" ADD CONSTRAINT "hitl_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_tasks" ADD CONSTRAINT "hitl_tasks_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_tasks" ADD CONSTRAINT "hitl_tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_tasks" ADD CONSTRAINT "hitl_tasks_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hitl_tasks" ADD CONSTRAINT "hitl_tasks_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Vector index for semantic retrieval on tenant-scoped chunks
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx"
ON "knowledge_chunks"
USING hnsw ("embedding" vector_cosine_ops);
