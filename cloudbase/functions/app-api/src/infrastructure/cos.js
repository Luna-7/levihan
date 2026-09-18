'use strict';

const crypto = require('crypto');
const { ApiError } = require('../errors');
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const WORK_TYPES = new Set(['comic', 'novel', 'art', 'resource']);
const ASSET_KINDS = new Set(['cover', 'page', 'body', 'attachment', 'preview']);
const UUID_PART = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const SUBMISSION_STAGING_RE = new RegExp(`^staging/submissions/(${UUID_PART})/(${UUID_PART})/(${UUID_PART})/(${UUID_PART})\\.([a-z0-9]{1,12})$`);
const ADMIN_STAGING_RE = /^staging\/admin\/[A-Za-z0-9._/-]{1,900}$/;

function call(cos, method, params) {
  return new Promise((resolve, reject) => cos[method](params, (error, data) => error ? reject(error) : resolve(data || {})));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function exactKeys(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function validText(value, max, allowEmpty = false) { return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0); }
function validTimestamp(value) { return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)); }

function validatePublicCatalogDocument(document, bytes, { version, schemaVersion, generatedAt }) {
  const fail = () => { throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Immutable snapshot document is invalid'); };
  if (!exactKeys(document, ['schemaVersion', 'version', 'generatedAt', 'works']) || document.schemaVersion !== schemaVersion || document.version !== version || !validTimestamp(document.generatedAt) || (generatedAt !== undefined && document.generatedAt !== generatedAt) || !Array.isArray(document.works) || document.works.length > 10000) fail();
  let priorSlug = '';
  for (const work of document.works) {
    if (!exactKeys(work, ['slug', 'type', 'title', 'summary', 'rating', 'publishedAt', 'chapters', 'assets'])
      || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(work.slug || '') || work.slug <= priorSlug || !WORK_TYPES.has(work.type)
      || !validText(work.title, 120) || !validText(work.summary, 2000, true) || !['general', 'mature'].includes(work.rating)
      || !validTimestamp(work.publishedAt) || !Array.isArray(work.chapters) || work.chapters.length > 1000 || !Array.isArray(work.assets) || work.assets.length > 5000) fail();
    priorSlug = work.slug;
    let priorChapter;
    for (const chapter of work.chapters) {
      if (!exactKeys(chapter, ['title', 'position']) || !validText(chapter.title, 200) || !Number.isSafeInteger(chapter.position) || chapter.position < 1) fail();
      if (priorChapter && chapter.position <= priorChapter.position) fail();
      priorChapter = chapter;
    }
    let priorAsset;
    for (const asset of work.assets) {
      if (!exactKeys(asset, ['kind', 'path'], ['pageNo', 'chapterPosition']) || !ASSET_KINDS.has(asset.kind) || !/^media\/works\/[A-Za-z0-9._/-]{1,900}$/.test(asset.path || '') || asset.path.includes('..') || asset.path.includes('//')
        || (asset.pageNo !== undefined && (!Number.isSafeInteger(asset.pageNo) || asset.pageNo < 1))
        || (asset.chapterPosition !== undefined && (!Number.isSafeInteger(asset.chapterPosition) || asset.chapterPosition < 1)) || (asset.kind === 'page' && asset.pageNo === undefined)) fail();
      if (priorAsset) {
        const comparison = (asset.chapterPosition || 0) - (priorAsset.chapterPosition || 0) || (asset.pageNo || 0) - (priorAsset.pageNo || 0) || asset.kind.localeCompare(priorAsset.kind) || asset.path.localeCompare(priorAsset.path);
        if (comparison < 0) fail();
      }
      priorAsset = asset;
    }
  }
  if (!Buffer.from(canonicalJson(document)).equals(bytes)) fail();
  return document;
}

async function consumeBytes(body, maxBytes = MAX_SNAPSHOT_BYTES) {
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let total = 0;
  const source = Buffer.isBuffer(body) || typeof body === 'string' ? [body] : body;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk); total += bytes.length;
    if (total > maxBytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Immutable snapshot exceeds the validation limit');
    chunks.push(bytes); hash.update(bytes);
  }
  return { bytes: Buffer.concat(chunks), checksum: hash.digest('hex') };
}

const COS_V5_SIGNATURE_FIELDS = new Set(['q-sign-algorithm', 'q-ak', 'q-sign-time', 'q-key-time', 'q-header-list', 'q-url-param-list', 'q-signature']);
const COS_V5_UNSIGNED_AUTH_FIELDS = new Set(['x-cos-security-token']);

function canonicalCosName(name) {
  return encodeURIComponent(name).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A').toLowerCase();
}
const COS_V5_RESERVED_CANONICAL_FIELDS = new Set([...COS_V5_SIGNATURE_FIELDS, ...COS_V5_UNSIGNED_AUTH_FIELDS].map(canonicalCosName));

function canonicalNameList(value) {
  if (value === '') return [];
  if (typeof value !== 'string') return null;
  const names = value.split(';');
  for (let index = 0; index < names.length; index += 1) {
    let decoded;
    try { decoded = decodeURIComponent(names[index]); } catch { return null; }
    if (!decoded || canonicalCosName(decoded) !== names[index] || (index > 0 && names[index - 1] >= names[index])) return null;
  }
  return names;
}

function validateSignedReadUrl(url, { expectedHost, expectedPath, nowSeconds }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed'); }
  const required = [...COS_V5_SIGNATURE_FIELDS];
  if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.host !== expectedHost
    || parsed.username || parsed.password || parsed.port || parsed.hash || parsed.pathname !== expectedPath
    || required.some((name) => parsed.searchParams.getAll(name).length !== 1)
    || parsed.searchParams.get('q-sign-algorithm') !== 'sha1'
    || !/^[A-Za-z0-9]{8,128}$/.test(parsed.searchParams.get('q-ak') || '')
    || !/^[a-f0-9]{40}$/.test(parsed.searchParams.get('q-signature') || '')) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
  }
  const signTime = parsed.searchParams.get('q-sign-time');
  const keyTime = parsed.searchParams.get('q-key-time');
  if (signTime !== keyTime || !/^\d{10};\d{10}$/.test(signTime || '')) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
  const [start, end] = signTime.split(';').map(Number);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 300
    || start > nowSeconds || start < nowSeconds - 60 || end <= nowSeconds || end > nowSeconds + 300) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
  const signedHeaders = canonicalNameList(parsed.searchParams.get('q-header-list'));
  const signedQueryNames = canonicalNameList(parsed.searchParams.get('q-url-param-list'));
  const actualQueryNames = [];
  const seenQueryNames = new Set();
  for (const [name] of parsed.searchParams) {
    if (COS_V5_SIGNATURE_FIELDS.has(name)) continue;
    if (COS_V5_UNSIGNED_AUTH_FIELDS.has(name)) {
      if (parsed.searchParams.getAll(name).length !== 1 || !parsed.searchParams.get(name)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
      continue;
    }
    const canonical = canonicalCosName(name);
    if (COS_V5_RESERVED_CANONICAL_FIELDS.has(canonical) || seenQueryNames.has(canonical)) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
    seenQueryNames.add(canonical); actualQueryNames.push(canonical);
  }
  actualQueryNames.sort();
  if (!signedHeaders || signedHeaders.length !== 1 || signedHeaders[0] !== 'host' || !signedQueryNames
    || signedQueryNames.length !== actualQueryNames.length || signedQueryNames.some((name, index) => name !== actualQueryNames[index])) {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
  }
  return { url: parsed.toString(), expiresAt: new Date(end * 1000).toISOString() };
}

function createCosObjectStore({ publicBucket, privateBucket, region, cos, clock = () => Date.now(), credentials }) {
  if (!publicBucket || !privateBucket || !region || !cos) throw new Error('COS public/private buckets, region and client are required');
  return {
    async health() {
      try {
        const [, , publicAcl, privateAcl, publicCors, privateCors] = await Promise.all([
          call(cos, 'headBucket', { Bucket: publicBucket, Region: region }),
          call(cos, 'headBucket', { Bucket: privateBucket, Region: region }),
          call(cos, 'getBucketACL', { Bucket: publicBucket, Region: region }),
          call(cos, 'getBucketACL', { Bucket: privateBucket, Region: region }),
          call(cos, 'getBucketCors', { Bucket: publicBucket, Region: region }),
          call(cos, 'getBucketCors', { Bucket: privateBucket, Region: region }),
        ]);
        return {
          ok: true, region, publicBucketConfigured: Boolean(publicAcl), privateBucketConfigured: Boolean(privateAcl),
          publicCorsConfigured: Array.isArray(publicCors?.CORSRules), privateCorsConfigured: Array.isArray(privateCors?.CORSRules),
        };
      } catch {
        return { ok: false, region, publicBucketConfigured: false, privateBucketConfigured: false, publicCorsConfigured: false, privateCorsConfigured: false };
      }
    },
    async signGet({ objectKey, expiresInSeconds }) {
      if (expiresInSeconds !== 300 || !/^protected\/works\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(objectKey) || objectKey.includes('..') || objectKey.includes('//')) throw new ApiError(400, 'VALIDATION_FAILED', 'Private read signing constraints are invalid');
      const data = await call(cos, 'getObjectUrl', { Bucket: privateBucket, Region: region, Key: objectKey, Method: 'GET', Sign: true, Expires: expiresInSeconds });
      const url = typeof data === 'string' ? data : data.Url;
      if (typeof url !== 'string') throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
      return validateSignedReadUrl(url, {
        expectedHost: `${privateBucket}.cos.${region}.myqcloud.com`,
        expectedPath: `/${objectKey}`,
        nowSeconds: Math.floor(clock() / 1000),
      });
    },
    async signPut({ objectKey, contentType, contentLength, checksum, expiresInSeconds }) {
      if (expiresInSeconds !== 300 || !ADMIN_STAGING_RE.test(objectKey) || objectKey.includes('..') || objectKey.includes('//')) throw new ApiError(400, 'VALIDATION_FAILED', 'Upload signing constraints are invalid');
      const headers = { 'Content-Type': contentType, 'x-cos-meta-sha256': checksum };
      const data = await call(cos, 'getObjectUrl', { Bucket: privateBucket, Region: region, Key: objectKey, Method: 'PUT', Sign: true, Expires: expiresInSeconds, Headers: headers });
      const url = typeof data === 'string' ? data : data.Url;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing failed');
      return { url, headers: { 'content-type': contentType, 'x-cos-meta-sha256': checksum } };
    },
    async signPost({ objectKey, contentType, contentLength, checksum, expiresInSeconds }) {
      if (expiresInSeconds !== 300 || !SUBMISSION_STAGING_RE.test(objectKey) || !Number.isSafeInteger(contentLength) || contentLength < 1
        || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType || '') || !/^[a-f0-9]{64}$/.test(checksum || '')) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Submission upload signing constraints are invalid');
      }
      const secretId = credentials?.secretId;
      const secretKey = credentials?.secretKey;
      const securityToken = credentials?.securityToken;
      if (!secretId || !secretKey) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS signing credentials are unavailable');
      const start = Math.floor(clock() / 1000);
      const end = start + expiresInSeconds;
      const keyTime = `${start};${end}`;
      const conditions = [
        { bucket: privateBucket },
        ['eq', '$key', objectKey],
        ['content-length-range', 1, contentLength],
        ['eq', '$Content-Type', contentType],
        ['eq', '$x-cos-meta-sha256', checksum],
        { 'q-sign-algorithm': 'sha1' },
        { 'q-ak': secretId },
        { 'q-sign-time': keyTime },
      ];
      if (securityToken) conditions.push(['eq', '$x-cos-security-token', securityToken]);
      const policy = Buffer.from(JSON.stringify({ expiration: new Date(end * 1000).toISOString(), conditions })).toString('base64');
      const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
      const signature = crypto.createHmac('sha1', signKey).update(crypto.createHash('sha1').update(policy).digest('hex')).digest('hex');
      return {
        url: `https://${privateBucket}.cos.${region}.myqcloud.com/`,
        fields: {
          key: objectKey, 'Content-Type': contentType, 'x-cos-meta-sha256': checksum,
          'q-sign-algorithm': 'sha1', 'q-ak': secretId, 'q-key-time': keyTime, 'q-signature': signature, policy,
          ...(securityToken ? { 'x-cos-security-token': securityToken } : {}),
        },
      };
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
    async headFinal({ objectKey, storageZone }) {
      const bucket = storageZone === 'public' ? publicBucket : storageZone === 'private' ? privateBucket : null;
      if (!bucket) throw new ApiError(400, 'VALIDATION_FAILED', 'Storage zone is invalid');
      const data = await call(cos, 'headObject', { Bucket: bucket, Region: region, Key: objectKey });
      const headers = data.headers || data.Headers || {};
      return { sizeBytes: Number(headers['content-length'] ?? data.ContentLength), contentType: String(headers['content-type'] ?? data.ContentType ?? '').split(';', 1)[0].trim().toLowerCase(), etag: String(headers.etag ?? data.ETag ?? '').replace(/^"|"$/g, '') };
    },
    async readFinal({ objectKey, storageZone }) {
      const bucket = storageZone === 'public' ? publicBucket : storageZone === 'private' ? privateBucket : null;
      if (!bucket) throw new ApiError(400, 'VALIDATION_FAILED', 'Storage zone is invalid');
      return (await call(cos, 'getObject', { Bucket: bucket, Region: region, Key: objectKey })).Body;
    },
    async promote({ sourceKey, destinationKey, storageZone, contentType }) {
      const destinationBucket = storageZone === 'public' ? publicBucket : storageZone === 'private' ? privateBucket : null;
      const submission = sourceKey.match(SUBMISSION_STAGING_RE);
      const validAdmin = ADMIN_STAGING_RE.test(sourceKey) && !sourceKey.includes('..') && !sourceKey.includes('//') && (destinationKey.startsWith('media/works/') || destinationKey.startsWith('protected/works/'));
      const validSubmission = submission && storageZone === 'private' && destinationKey === `protected/works/${submission[2]}/${submission[4]}.${submission[5]}`;
      if (!destinationBucket || !(validAdmin || validSubmission)) throw new ApiError(400, 'VALIDATION_FAILED', 'COS promotion constraints are invalid');
      await call(cos, 'putObjectCopy', { Bucket: destinationBucket, Region: region, Key: destinationKey, CopySource: `${privateBucket}.cos.${region}.myqcloud.com/${sourceKey}`, MetadataDirective: 'Replaced', ContentType: contentType, ...(['application/pdf', 'application/epub+zip'].includes(contentType) ? { ContentDisposition: 'attachment' } : {}) });
    },
    async putImmutable(objectKey, bytes, { cacheControl, version, schemaVersion }) {
      const versioning = await call(cos, 'getBucketVersioning', { Bucket: publicBucket, Region: region });
      const config = versioning && versioning.VersioningConfiguration;
      if (!config || Object.getPrototypeOf(config) !== Object.prototype || Object.keys(config).some((key) => key !== 'Status') || (config.Status !== undefined && !['Enabled', 'Suspended'].includes(config.Status))) throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'COS bucket versioning configuration is unavailable');
      if (config.Status === 'Enabled') throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Public snapshot bucket versioning must be disabled');
      const proposed = await consumeBytes(bytes);
      let proposedDocument;
      try { proposedDocument = JSON.parse(proposed.bytes.toString('utf8')); } catch { throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Immutable snapshot document is invalid'); }
      validatePublicCatalogDocument(proposedDocument, proposed.bytes, { version, schemaVersion, generatedAt: proposedDocument.generatedAt });
      try {
        await call(cos, 'putObject', { Bucket: publicBucket, Region: region, Key: objectKey, Body: proposed.bytes, ContentType: 'application/json; charset=utf-8', CacheControl: cacheControl, Headers: { 'x-cos-forbid-overwrite': 'true' } });
        return { bytes: proposed.bytes, checksum: proposed.checksum, existed: false };
      } catch (error) {
        if (!error || !['FileAlreadyExists', '409'].includes(String(error.code || error.statusCode))) throw error;
        const existing = await call(cos, 'getObject', { Bucket: publicBucket, Region: region, Key: objectKey });
        const actualResult = await consumeBytes(existing.Body);
        const actual = actualResult.bytes;
        let document;
        try { document = JSON.parse(actual.toString('utf8')); } catch { throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Existing immutable snapshot is invalid'); }
        validatePublicCatalogDocument(document, actual, { version, schemaVersion, generatedAt: proposedDocument.generatedAt });
        return { bytes: actual, checksum: actualResult.checksum, existed: true };
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
  return createCosObjectStore({
    publicBucket: config.cosPublicBucket, privateBucket: config.cosPrivateBucket, region: config.cosRegion, cos,
    credentials: { secretId: env.TENCENTCLOUD_SECRETID, secretKey: env.TENCENTCLOUD_SECRETKEY, securityToken: env.TENCENTCLOUD_SESSIONTOKEN },
  });
}

module.exports = { createCosObjectStore, createRuntimeCosObjectStore, validatePublicCatalogDocument };
