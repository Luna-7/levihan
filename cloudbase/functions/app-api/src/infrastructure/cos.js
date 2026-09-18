'use strict';

const { ApiError } = require('../errors');

function call(cos, method, params) {
  return new Promise((resolve, reject) => cos[method](params, (error, data) => error ? reject(error) : resolve(data || {})));
}

function createCosObjectStore({ bucket, region, cos }) {
  if (!bucket || !region || !cos) throw new Error('COS bucket, region and client are required');
  return {
    async signPut({ objectKey, contentType, contentLength, checksum, expiresInSeconds }) {
      if (expiresInSeconds !== 300 || !objectKey.startsWith('staging/admin/')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload signing constraints are invalid');
      const headers = { 'Content-Type': contentType, 'Content-Length': contentLength, 'x-cos-meta-sha256': checksum };
      const data = await call(cos, 'getObjectUrl', { Bucket: bucket, Region: region, Key: objectKey, Method: 'PUT', Sign: true, Expires: expiresInSeconds, Headers: headers });
      const url = typeof data === 'string' ? data : data.Url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
      return { url, headers: { 'content-type': contentType, 'content-length': String(contentLength), 'x-cos-meta-sha256': checksum } };
    },
    async head({ objectKey }) {
      const data = await call(cos, 'headObject', { Bucket: bucket, Region: region, Key: objectKey });
      const headers = data.headers || data.Headers || {};
      return {
        sizeBytes: Number(headers['content-length'] ?? data.ContentLength),
        contentType: String(headers['content-type'] ?? data.ContentType ?? '').split(';', 1)[0].trim().toLowerCase(),
        checksum: String(headers['x-cos-meta-sha256'] ?? (data.Metadata && data.Metadata.sha256) ?? '').toLowerCase(),
        etag: String(headers.etag ?? data.ETag ?? '').replace(/^"|"$/g, ''),
      };
    },
    async putJson(objectKey, document, options = {}) {
      if (options.sourceKey) {
        await call(cos, 'putObjectCopy', {
          Bucket: bucket, Region: region, Key: objectKey,
          CopySource: `${bucket}.cos.${region}.myqcloud.com/${options.sourceKey}`,
          MetadataDirective: 'Replaced', ContentType: 'application/json; charset=utf-8', CacheControl: options.cacheControl,
        });
        return;
      }
      await call(cos, 'putObject', {
        Bucket: bucket, Region: region, Key: objectKey,
        Body: Buffer.from(JSON.stringify(document)), ContentType: 'application/json; charset=utf-8', CacheControl: options.cacheControl,
      });
    },
    async delete(objectKey) {
      try { await call(cos, 'deleteObject', { Bucket: bucket, Region: region, Key: objectKey }); }
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
  return createCosObjectStore({ bucket: config.cosBucket, region: config.cosRegion, cos });
}

module.exports = { createCosObjectStore, createRuntimeCosObjectStore };
