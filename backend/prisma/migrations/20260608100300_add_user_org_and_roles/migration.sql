-- Adds organizationId and roles to the User table, included in auth responses.
-- Defaulted to single-tenant values; extend with a proper org/roles model as needed.

ALTER TABLE "User"
  ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'org-001',
  ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY['employee']::TEXT[];
