import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

const BUCKET = 'levihan-1325571558';
const REGION = 'ap-nanjing';
const ENDPOINT = 'https://cos.ap-nanjing.myqcloud.com';
const EXPORT_DIR = path.resolve('public/manga-preview-export');
const VOLUMES = ['01', '02'];
const EXPECTED_PAGES = 191;
const CONCURRENCY = 6;

const secretId = process.env.COS_SECRET_ID;
const secretKey = process.env.COS_SECRET_KEY;
if (!secretId || !secretKey) {
  console.error('未配置 COS_SECRET_ID / COS_SECRET_KEY，未上传预览图片。');
  process.exit(1);
}

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: { accessKeyId: secretId, secretAccessKey: secretKey },
});

for (const volume of VOLUMES) {
  const localDir = path.join(EXPORT_DIR, 'volume-' + volume);
  if (!fs.existsSync(localDir)) {
    console.error('找不到 ' + localDir + '，请先运行 MOBI 转换脚本。');
    process.exit(1);
  }

  const files = fs.readdirSync(localDir)
    .filter((file) => /^page-\d{3}\.webp$/.test(file))
    .sort();
  if (files.length !== EXPECTED_PAGES) {
    console.error('第 ' + volume + ' 卷需要 ' + EXPECTED_PAGES + ' 页，当前找到 ' + files.length + ' 页。');
    process.exit(1);
  }

  for (let start = 0; start < files.length; start += CONCURRENCY) {
    const batch = files.slice(start, start + CONCURRENCY);
    await Promise.all(batch.map(async (file) => {
      const filePath = path.join(localDir, file);
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: '无悔的选择/volume-' + volume + '/' + file,
        Body: fs.createReadStream(filePath),
        ContentLength: fs.statSync(filePath).size,
        ContentType: 'image/webp',
        ContentDisposition: 'inline',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    }));
  }

  console.log('第 ' + volume + ' 卷已上传 ' + files.length + ' 页。');
}

fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
console.log('已清理本地预览副本，避免构建时把图片打进主站包。');
