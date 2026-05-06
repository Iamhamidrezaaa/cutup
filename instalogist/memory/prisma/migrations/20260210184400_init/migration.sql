-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('markdown_workspace', 'github', 'stripe', 'auth_logs', 'analytics', 'customer_support', 'deployment', 'admin_api', 'system', 'seed', 'unknown');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('pending', 'acknowledged', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "DeploymentEventStatus" AS ENUM ('started', 'success', 'failure', 'rolled_back', 'cancelled');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT,
    "role" TEXT,
    "metadata" JSONB,
    "source" "MemorySource" NOT NULL DEFAULT 'system',
    "source_ref" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "priority" TEXT,
    "risk_class" TEXT,
    "workspace_path" TEXT,
    "owner_agent_id" TEXT,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "source_generated_at" TIMESTAMP(3),
    "payload" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT,
    "priority" TEXT,
    "workspace_path" TEXT,
    "owner_agent_id" TEXT,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "source_generated_at" TIMESTAMP(3),
    "payload" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "decided_by" TEXT NOT NULL,
    "task_id" TEXT,
    "incident_id" TEXT,
    "supersedes_id" TEXT,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "metadata" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "title" TEXT,
    "related_task_id" TEXT,
    "related_incident_id" TEXT,
    "channel" TEXT,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "payload" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL,
    "from_agent_id" TEXT NOT NULL,
    "to_agent_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "task_id" TEXT,
    "incident_id" TEXT,
    "status" "EscalationStatus" NOT NULL DEFAULT 'pending',
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "metadata" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_events" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "service_name" TEXT,
    "version" TEXT,
    "git_sha" TEXT,
    "status" "DeploymentEventStatus" NOT NULL,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "payload" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_summaries" (
    "id" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "contract_id" TEXT,
    "parser_version" TEXT,
    "snapshot_status" TEXT,
    "summary" JSONB NOT NULL,
    "items_count" INTEGER,
    "source" "MemorySource" NOT NULL,
    "source_ref" TEXT,
    "source_generated_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operational_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"("code");

-- CreateIndex
CREATE INDEX "agents_source_idx" ON "agents"("source");

-- CreateIndex
CREATE INDEX "agents_generated_at_idx" ON "agents"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workspace_path_key" ON "tasks"("workspace_path");

-- CreateIndex
CREATE INDEX "tasks_owner_agent_id_idx" ON "tasks"("owner_agent_id");

-- CreateIndex
CREATE INDEX "tasks_status_idx" ON "tasks"("status");

-- CreateIndex
CREATE INDEX "tasks_generated_at_idx" ON "tasks"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tasks_source_external_key_key" ON "tasks"("source", "external_key");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_workspace_path_key" ON "incidents"("workspace_path");

-- CreateIndex
CREATE INDEX "incidents_owner_agent_id_idx" ON "incidents"("owner_agent_id");

-- CreateIndex
CREATE INDEX "incidents_priority_idx" ON "incidents"("priority");

-- CreateIndex
CREATE INDEX "incidents_generated_at_idx" ON "incidents"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_source_external_key_key" ON "incidents"("source", "external_key");

-- CreateIndex
CREATE INDEX "decisions_task_id_idx" ON "decisions"("task_id");

-- CreateIndex
CREATE INDEX "decisions_incident_id_idx" ON "decisions"("incident_id");

-- CreateIndex
CREATE INDEX "decisions_decided_by_idx" ON "decisions"("decided_by");

-- CreateIndex
CREATE INDEX "decisions_generated_at_idx" ON "decisions"("generated_at" DESC);

-- CreateIndex
CREATE INDEX "conversations_agent_id_idx" ON "conversations"("agent_id");

-- CreateIndex
CREATE INDEX "conversations_related_task_id_idx" ON "conversations"("related_task_id");

-- CreateIndex
CREATE INDEX "conversations_related_incident_id_idx" ON "conversations"("related_incident_id");

-- CreateIndex
CREATE INDEX "conversations_generated_at_idx" ON "conversations"("generated_at" DESC);

-- CreateIndex
CREATE INDEX "escalations_from_agent_id_idx" ON "escalations"("from_agent_id");

-- CreateIndex
CREATE INDEX "escalations_to_agent_id_idx" ON "escalations"("to_agent_id");

-- CreateIndex
CREATE INDEX "escalations_status_idx" ON "escalations"("status");

-- CreateIndex
CREATE INDEX "escalations_reason_code_idx" ON "escalations"("reason_code");

-- CreateIndex
CREATE INDEX "escalations_generated_at_idx" ON "escalations"("generated_at" DESC);

-- CreateIndex
CREATE INDEX "deployment_events_environment_idx" ON "deployment_events"("environment");

-- CreateIndex
CREATE INDEX "deployment_events_git_sha_idx" ON "deployment_events"("git_sha");

-- CreateIndex
CREATE INDEX "deployment_events_status_idx" ON "deployment_events"("status");

-- CreateIndex
CREATE INDEX "deployment_events_generated_at_idx" ON "deployment_events"("generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "operational_summaries_snapshot_key_key" ON "operational_summaries"("snapshot_key");

-- CreateIndex
CREATE INDEX "operational_summaries_contract_id_idx" ON "operational_summaries"("contract_id");

-- CreateIndex
CREATE INDEX "operational_summaries_generated_at_idx" ON "operational_summaries"("generated_at" DESC);

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_agent_id_fkey" FOREIGN KEY ("owner_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_agent_id_fkey" FOREIGN KEY ("owner_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_related_task_id_fkey" FOREIGN KEY ("related_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_related_incident_id_fkey" FOREIGN KEY ("related_incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_from_agent_id_fkey" FOREIGN KEY ("from_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_to_agent_id_fkey" FOREIGN KEY ("to_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
