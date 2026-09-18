'use strict';

const { ApiError } = require('../errors');

function call(cos, method, params) {
  return new Promise((resolve, reject) => cos[method](params, (error, data) => error ? reject(error) : resolve(data || {})));
}

function createCosObjectStore({ publicBucket, privateBucket, region, cos }) {
  if (!publicBucket || !privateBucket || !region || !cos) throw new Error('COS public/private buckets, region and client are required');
  return {
    async signPut({ objectKey, contentType, contentLength, checksum, expiresInSeconds }) {
      if (expiresInSeconds !== 300 || !objectKey.startsWith('staging/admin/')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload signing constraints are invalid');
      const headers = { 'Content-Type': contentType, 'x-cos-meta-sha256': checksum };
      const data = await call(cos, 'getObjectUrl', { Bucket: privateBucket, Region: region, Key: objectKey, Method: 'PUT', Sign: true, Expires: expiresInSeconds, Headers: headers });
      const url = typeof data === 'string' ? data : data.Url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
      return { url, headers: { 'content-type': contentType, 'x-cos-meta-sha256': checksum } };
    },
    async head({ objectKey }) {
      const data = await call(cos, 'headObject', { Bucket: privateBucket, Region: region, Key: objectKey });
      const headers = data.headers || data.Headers || {};
      return {
        sizeBytes: Number(headers['content-length'] ?? data.ContentLength),
        contentType: String(headers['content-type'] ?? data.ContentType ?? '').split(';', 1)[0].trim().toLowerCase(),
        checksum: String(headers['x-cos-meta-sha256'] ?? (data.Metadata && data.Metadata.sha256) ?? '').toLowerCase(),
        etag: String(headers.etag ?? data.ETag ?? '').replace(/^"|"$/g, ''),
      };
    },
    async read({ objectKey }) {
      const data = await call(cos, 'getObject', { Bucket: privateBucket, Region: region, Key: objectKey });
      return data.Body;
    },
    async promote({ sourceKey, destinationKey, storageZone, contentType }) {
      const destinationBucket = storageZone === 'public' ? publicBucket : storageZone === 'private' ? privateBucket : null;
      if (!destinationBucket || !sourceKey.startsWith('staging/admin/') || !(destinationKey.startsWith('media/works/') || destinationKey.startsWith('protected/works/'))) throw new ApiError(400, 'VALIDATION_FAILED', 'COS promotion constraints are invalid');
      await call(cos, 'putObjectCopy', { Bucket: destinationBucket, Region: region, Key: destinationKey, CopySource: `${privateBucket}.cos.${region}.myqcloud.com/${sourceKey}`, MetadataDirective: 'Replaced', ContentType: contentType });
    },
    async putBytes(objectKey, bytes, options = {}) {
      if (options.sourceKey) {
        await call(cos, 'putObjectCopy', {
          Bucket: publicBucket, Region: region, Key: objectKey,
          CopySource: `${publicBucket}.cos.${region}.myqcloud.com/${options.sourceKey}`,
          MetadataDirective: 'Replaced', ContentType: 'application/json; charset=utf-8', CacheControl: options.cacheControl,
        });
        return;
      }
      await call(cos, 'putObject', {
        Bucket: publicBucket, Region: region, Key: objectKey,
        Body: bytes, ContentType: 'application/json; charset=utf-8', CacheControl: options.cacheControl,
      });
    },
    async putManifest(manifest) {
      await call(cos, 'putObject', { Bucket: publicBucket, Region: region, Key: 'snapshots/public/manifest.json', Body: Buffer.from(JSON.stringify(manifest)), ContentType: 'application/json; charset=utf-8', CacheControl: 'public,max-age=60,must-revalidate' });
    },
    async getManifest() {
      try {
        const data = await call(cos, 'getObject', { Bucket: publicBucket, Region: region, Key: 'snapshots/public/manifest.json' });
        return JSON.parse(Buffer.from(data.Body).toString('utf8'));
      } catch (error) {
        if (error && ['NoSuchKey', 'NotFound'].includes(error.code)) return null;
        throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Snapshot manifest unavailable');
      }
    },
    async delete(objectKey) {
      try { await call(cos, 'deleteObject', { Bucket: objectKey.startsWith('staging/') || objectKey.startsWith('protected/') ? privateBucket : publicBucket, Region: region, Key: objectKey }); }
      catch (error) { if (!error || !['NoSuchKey', 'NotFound'].includes(error.code)) throw error; }
    },
  };
}

function createRuntimeCosObjectStore({ config, env = process.env, COS }) {
  const Client = COS || require('cos-nodejs-sdk-v5');
  const cos = new Client({
    SecretId: env.TENCENTCLOUD_SECRETID,
    SecretKey: env.TENCENTCLOUD_SECRETKEY,
    SecurityToken: env.TENCENTCLOUD_SESSIONTOKEN,
    Protocol: 'https:',
  });
  return createCosObjectStore({ publicBucket: config.cosPublicBucket, privateBucket: config.cosPrivateBucket, region: config.cosRegion, cos });
}

module.exports = { createCosObjectStore, createRuntimeCosObjectStore };
