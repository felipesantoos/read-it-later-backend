import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import crypto from 'crypto';

// Cloudflare R2 is compatible with S3 API
const s3Client = new S3Client({
  region: 'auto',
  endpoint: env.cloudflareR2AccountId 
    ? `https://${env.cloudflareR2AccountId}.r2.cloudflarestorage.com`
    : undefined,
  credentials: env.cloudflareR2AccessKeyId && env.cloudflareR2SecretAccessKey
    ? {
        accessKeyId: env.cloudflareR2AccessKeyId,
        secretAccessKey: env.cloudflareR2SecretAccessKey,
      }
    : undefined,
});

export interface UploadResult {
  fileUrl: string;
  fileName: string;
  fileSize: number;
}

/**
 * Upload a file to Cloudflare R2
 */
export async function uploadFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  userId: string
): Promise<UploadResult> {
  if (!env.cloudflareR2BucketName) {
    throw new Error('Cloudflare R2 bucket name not configured');
  }

  // Generate unique file name: userId/timestamp-random-originalName
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const fileExtension = sanitizedFileName.split('.').pop() || '';
  const uniqueFileName = `${userId}/${timestamp}-${random}.${fileExtension}`;

  try {
    const command = new PutObjectCommand({
      Bucket: env.cloudflareR2BucketName,
      Key: uniqueFileName,
      Body: buffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);

    // Generate public URL
    const fileUrl = env.cloudflareR2PublicUrl
      ? `${env.cloudflareR2PublicUrl}/${uniqueFileName}`
      : `https://${env.cloudflareR2AccountId}.r2.cloudflarestorage.com/${env.cloudflareR2BucketName}/${uniqueFileName}`;

    return {
      fileUrl,
      fileName: sanitizedFileName,
      fileSize: buffer.length,
    };
  } catch (error) {
    console.error('Error uploading file to R2:', error);
    throw new Error('Failed to upload file to storage');
  }
}

/**
 * Delete a file from Cloudflare R2
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  if (!env.cloudflareR2BucketName) {
    throw new Error('Cloudflare R2 bucket name not configured');
  }

  try {
    // Extract key from URL
    // URL format: https://public-url.com/userId/timestamp-random.ext
    // or: https://accountId.r2.cloudflarestorage.com/bucketName/userId/timestamp-random.ext
    let key: string;
    
    if (env.cloudflareR2PublicUrl && fileUrl.startsWith(env.cloudflareR2PublicUrl)) {
      key = fileUrl.replace(env.cloudflareR2PublicUrl + '/', '');
    } else if (fileUrl.includes('/' + env.cloudflareR2BucketName + '/')) {
      key = fileUrl.split('/' + env.cloudflareR2BucketName + '/')[1];
    } else {
      // Try to extract from any URL format
      const urlParts = fileUrl.split('/');
      const bucketIndex = urlParts.findIndex(part => part === env.cloudflareR2BucketName);
      if (bucketIndex >= 0 && bucketIndex < urlParts.length - 1) {
        key = urlParts.slice(bucketIndex + 1).join('/');
      } else {
        throw new Error('Could not extract file key from URL');
      }
    }

    const command = new DeleteObjectCommand({
      Bucket: env.cloudflareR2BucketName,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('Error deleting file from R2:', error);
    // Don't throw - file deletion is not critical
  }
}

/**
 * Generate hash from file buffer for duplicate detection
 */
export function generateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}


