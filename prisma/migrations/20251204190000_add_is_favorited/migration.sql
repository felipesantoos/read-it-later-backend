-- AlterTable: Add isFavorited column
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "isFavorited" BOOLEAN NOT NULL DEFAULT false;

-- Migrate existing data: Set isFavorited = true for articles with status = 'FAVORITED'
UPDATE "Article" SET "isFavorited" = true WHERE "status" = 'FAVORITED';

-- Update status to UNREAD for articles that were FAVORITED (since FAVORITED is being removed from enum)
UPDATE "Article" SET "status" = 'UNREAD' WHERE "status" = 'FAVORITED';

-- AlterEnum: Remove FAVORITED from ArticleStatus enum
-- First, we need to create a new enum without FAVORITED
CREATE TYPE "ArticleStatus_new" AS ENUM ('UNREAD', 'READING', 'FINISHED', 'ARCHIVED');

-- Remove default temporarily
ALTER TABLE "Article" ALTER COLUMN "status" DROP DEFAULT;

-- Update the column to use the new enum
ALTER TABLE "Article" ALTER COLUMN "status" TYPE "ArticleStatus_new" USING (
  CASE 
    WHEN "status"::text = 'FAVORITED' THEN 'UNREAD'::"ArticleStatus_new"
    ELSE "status"::text::"ArticleStatus_new"
  END
);

-- Restore default
ALTER TABLE "Article" ALTER COLUMN "status" SET DEFAULT 'UNREAD'::"ArticleStatus_new";

-- Drop the old enum
DROP TYPE "ArticleStatus";

-- Rename the new enum to the original name
ALTER TYPE "ArticleStatus_new" RENAME TO "ArticleStatus";
