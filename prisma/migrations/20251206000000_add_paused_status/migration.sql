-- AlterEnum: Add PAUSED to ArticleStatus enum
-- First, we need to create a new enum with PAUSED
CREATE TYPE "ArticleStatus_new" AS ENUM ('UNREAD', 'READING', 'PAUSED', 'FINISHED', 'ARCHIVED');

-- Remove default temporarily
ALTER TABLE "Article" ALTER COLUMN "status" DROP DEFAULT;

-- Update the column to use the new enum
ALTER TABLE "Article" ALTER COLUMN "status" TYPE "ArticleStatus_new" USING (
  "status"::text::"ArticleStatus_new"
);

-- Restore default
ALTER TABLE "Article" ALTER COLUMN "status" SET DEFAULT 'UNREAD'::"ArticleStatus_new";

-- Drop the old enum
DROP TYPE "ArticleStatus";

-- Rename the new enum to the original name
ALTER TYPE "ArticleStatus_new" RENAME TO "ArticleStatus";


