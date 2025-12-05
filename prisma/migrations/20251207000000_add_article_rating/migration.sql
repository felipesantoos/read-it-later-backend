-- AlterTable: Add rating column to Article
ALTER TABLE "Article" ADD COLUMN IF NOT EXISTS "rating" INTEGER;

