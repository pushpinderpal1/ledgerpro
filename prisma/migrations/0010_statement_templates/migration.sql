-- Custom financial statement templates
CREATE TABLE "statement_templates" (
  "id" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "lines" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "statement_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "statement_templates_entityId_name_key" ON "statement_templates"("entityId", "name");
CREATE INDEX "statement_templates_entityId_idx" ON "statement_templates"("entityId");

ALTER TABLE "statement_templates" ADD CONSTRAINT "statement_templates_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
