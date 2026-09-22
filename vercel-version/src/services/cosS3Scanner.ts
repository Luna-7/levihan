import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { COSConfigState } from './cosClient';

let client: S3Client | null = null;
let clientKey = '';

export async function scanCosObjects(config: COSConfigState, prefix: string): Promise<string[]> {
  if (!config.accessKeyId || !config.secretAccessKey || !config.s3ApiEndpoint) {
    throw new Error('未配置腾讯云 COS S3 密钥 (SecretId / SecretKey)');
  }

  const nextKey = JSON.stringify([config.region, config.s3ApiEndpoint, config.accessKeyId, config.secretAccessKey]);
  if (!client || clientKey !== nextKey) {
    client = new S3Client({
      region: config.region || 'auto',
      endpoint: config.s3ApiEndpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    clientKey = nextKey;
  }

  const response = await client.send(new ListObjectsV2Command({
    Bucket: config.bucketName,
    Prefix: prefix,
    MaxKeys: 100,
  }));
  return (response.Contents || []).map((item) => item.Key || '').filter(Boolean);
}
