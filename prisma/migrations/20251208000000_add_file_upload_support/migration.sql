-- AlterTable
ALTER TABLE "Article" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "Article" ALTER COLUMN "urlHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Article" ADD COLUMN "fileUrl" TEXT,
ADD COLUMN "fileName" TEXT,
ADD COLUMN "fileSize" INTEGER,
ADD COLUMN "fileType" TEXT,
ADD COLUMN "fileHash" TEXT;

-- CreateIndex
CREATE INDEX "Article_fileHash_idx" ON "Article"("fileHash");


