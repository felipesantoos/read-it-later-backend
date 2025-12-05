import dotenv from "dotenv";

dotenv.config();

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(process.env.DATABASE_URL, "DATABASE_URL"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  tokenAdminSecret: process.env.TOKEN_ADMIN_SECRET ?? "",
  cloudflareR2AccountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
  cloudflareR2AccessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
  cloudflareR2SecretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  cloudflareR2BucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME,
  cloudflareR2PublicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL,
};

