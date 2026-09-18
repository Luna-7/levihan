'use strict';

const IDEMPOTENCY_MODES = new Set(['none', 'supported', 'required']);
const SAFE_RESPONSE_HEADERS = new Set(['etag']);
const RESPONSE_TYPES = new Set(['boolean', 'integer', 'number', 'uuid', 'iso-date']);
const SENSITIVE_ALLOWLIST_SEMANTICS = /token|cookie|password|secret|recovery|signed|url|code|credential|authorization|location|ticket|session|csrf|key|signature|bearer/i;
const GENERIC_RESPONSE_FIELD = /^(value|data|result|payload)$/i;
const SAFE_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_ENUM_VALUE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function policyError() {
  return new Error('Invalid idempotency response policy');
}

function validateName(name, permittedHeaders) {
  if (typeof name !== 'string' || !SAFE_FIELD_NAME.test(name) || SENSITIVE_ALLOWLIST_SEMANTICS.test(name) || (!permittedHeaders && GENERIC_RESPONSE_FIELD.test(name))) throw policyError();
  if (permittedHeaders && !SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) throw policyError();
  return permittedHeaders ? name.toLowerCase() : name;
}

function validateDescriptor(descriptor) {
  if (!descriptor || Object.getPrototypeOf(descriptor) !== Object.prototype) throw policyError();
  if (Object.hasOwn(descriptor, 'enum')) {
    if (Object.keys(descriptor).length !== 1 || !Array.isArray(descriptor.enum) || !descriptor.enum.length || descriptor.enum.length > 32
      || new Set(descriptor.enum).size !== descriptor.enum.length
      || descriptor.enum.some((value) => typeof value !== 'string' || !SAFE_ENUM_VALUE.test(value) || SENSITIVE_ALLOWLIST_SEMANTICS.test(value))) throw policyError();
    return Object.freeze({ enum: Object.freeze([...descriptor.enum]) });
  }
  if (Object.keys(descriptor).length !== 1 || !RESPONSE_TYPES.has(descriptor.type)) throw policyError();
  return Object.freeze({ type: descriptor.type });
}

function validateResponsePolicy(responsePolicy) {
  if (!responsePolicy || Object.getPrototypeOf(responsePolicy) !== Object.prototype) throw policyError();
  if (Object.keys(responsePolicy).some((key) => !['statuses', 'body', 'headers'].includes(key))) throw policyError();
  const { statuses, body, headers = [] } = responsePolicy;
  if (!Array.isArray(statuses) || !statuses.length || new Set(statuses).size !== statuses.length || statuses.some((status) => !Number.isInteger(status) || status < 200 || status > 299)) throw policyError();
  if (!body || Object.getPrototypeOf(body) !== Object.prototype || !Object.keys(body).length) throw policyError();
  if (!Array.isArray(headers) || new Set(headers.map((header) => String(header).toLowerCase())).size !== headers.length) throw policyError();
  return Object.freeze({
    statuses: Object.freeze([...statuses]),
    body: Object.freeze(Object.fromEntries(Object.entries(body).map(([field, descriptor]) => [validateName(field, false), validateDescriptor(descriptor)]))),
    headers: Object.freeze(headers.map((header) => validateName(header, true))),
  });
}

function normalizeIdempotency(metadata) {
  const idempotency = metadata.idempotency;
  if (idempotency === undefined) return Object.freeze({ mode: 'none' });
  if (typeof idempotency === 'string') {
    if (!IDEMPOTENCY_MODES.has(idempotency)) throw policyError();
    // Legacy strings remain readable, but can never enable keyed replay without a policy.
    return Object.freeze({ mode: idempotency });
  }
  if (!idempotency || Object.getPrototypeOf(idempotency) !== Object.prototype || !IDEMPOTENCY_MODES.has(idempotency.mode)) throw policyError();
  if (Object.keys(idempotency).some((key) => !['mode', 'responsePolicy'].includes(key))) throw policyError();
  if (idempotency.mode === 'none') {
    if (idempotency.responsePolicy !== undefined) throw policyError();
    return Object.freeze({ mode: 'none' });
  }
  if (!Object.hasOwn(idempotency, 'responsePolicy')) throw policyError();
  return Object.freeze({ mode: idempotency.mode, responsePolicy: validateResponsePolicy(idempotency.responsePolicy) });
}

function compilePath(path) {
  const keys = [];
  const source = path.split(/(\{[A-Za-z][A-Za-z0-9_]*\})/g).map((part) => {
    const match = /^\{([A-Za-z][A-Za-z0-9_]*)\}$/.exec(part);
    if (match) { keys.push(match[1]); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { regex: new RegExp(`^${source}$`), keys };
}

function createRouter() {
  const routes = [];
  function add(method, path, handler, metadata = {}) {
    const compiled = compilePath(path);
    routes.push({ method: method.toUpperCase(), path, handler, metadata: { ...metadata, idempotency: normalizeIdempotency(metadata) }, ...compiled });
  }
  function resolve(method, path) {
    const route = routes.find((item) => item.method === method.toUpperCase() && item.regex.test(path));
    if (!route) return null;
    const match = route.regex.exec(path);
    let params;
    try {
      params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
    } catch {
      const { ApiError } = require('./errors');
      throw new ApiError(400, 'VALIDATION_FAILED', 'Malformed route parameter');
    }
    return { ...route, params };
  }
  return {
    add,
    get: (path, handler, metadata) => add('GET', path, handler, metadata),
    post: (path, handler, metadata) => add('POST', path, handler, metadata),
    put: (path, handler, metadata) => add('PUT', path, handler, metadata),
    patch: (path, handler, metadata) => add('PATCH', path, handler, metadata),
    delete: (path, handler, metadata) => add('DELETE', path, handler, metadata),
    resolve,
  };
}

module.exports = { createRouter, validateResponsePolicy };
