'use strict';

function compilePath(path) {
  const keys = [];
  const source = path.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { regex: new RegExp(`^${source}$`), keys };
}

function createRouter() {
  const routes = [];
  function add(method, path, handler, metadata = {}) {
    const compiled = compilePath(path);
    routes.push({ method: method.toUpperCase(), path, handler, metadata, ...compiled });
  }
  function resolve(method, path) {
    const route = routes.find((item) => item.method === method.toUpperCase() && item.regex.test(path));
    if (!route) return null;
    const match = route.regex.exec(path);
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
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

module.exports = { createRouter };
