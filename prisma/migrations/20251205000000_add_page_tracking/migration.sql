-- AlterTable: Add totalPages and currentPage columns
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "totalPages" INTEGER;
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "currentPage" INTEGER;


