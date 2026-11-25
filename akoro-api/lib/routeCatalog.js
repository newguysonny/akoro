/**
 * lib/routeCatalog.js — pure helpers for the Express route table and docs
 * coverage.
 *
 * `extractRoutes(app)` walks the REAL Express router tree built by app.js and
 * returns one normalized row per method + full path. `parseOpenApi()`,
 * `parseCsv()` and `compareRouteTables()` are dependency-free so the same
 * helpers work in the API scripts and in CI.
 *
 * The runtime import is guarded by AKORO_ROUTE_EXPORT=1 in app.js; this module
 * itself has no side effects and never imports the app.
 */

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

// Express's own wrappers and body parsers. They apply to almost every route,
// so keeping them out of the middleware list makes the route table readable.
const GENERIC_MIDDLEWARE = new Set([
  "query", "expressInit", "router", "bound dispatch",
  "jsonParser", "urlencodedParser", "rawParser", "textParser",
]);

const normalizePath = (value) => {
  if (!value) return "/";
  let out = String(value).trim();
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/{2,}/g, "/");
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return out;
};

const joinPaths = (prefix, suffix) => {
  if (!prefix || prefix === "/") return normalizePath(suffix || "/");
  if (!suffix || suffix === "/") return normalizePath(prefix);
  return normalizePath(`${prefix.replace(/\/+$/, "")}/${String(suffix).replace(/^\/+/, "")}`);
};

/** Recover the mount path Express encoded in a layer's RegExp. */
const layerMount = (layer) => {
  const re = layer?.regexp;
  if (!re || re.fast_slash) return "";
  const source = String(re.source || "");
  // Sources look like ^\/api\/records\/?(?=\/|$) or ^\/?(?=\/|$).
  const cut = source.search(/\\\/\?\(\?=/);
  const raw = cut >= 0 ? source.slice(1, cut) : source.slice(1);
  let mount = raw.replace(/\\\//g, "/").replace(/\\\./g, ".");
  if (mount === "/") return "";
  return mount.replace(/\/+$/, "");
};

const prefixApplies = (fullPath, mount) => {
  if (!mount || mount === "/") return true;
  return fullPath === mount || fullPath.startsWith(`${mount}/`);
};

const addMiddleware = (target, name) => {
  if (name && !GENERIC_MIDDLEWARE.has(name) && !target.includes(name)) target.push(name);
};

const moduleFromSpecifier = (spec) => {
  const match = String(spec || "").match(/\.\/modules\/([^/]+)\//);
  return match ? match[1] : null;
};

/**
 * Map app.js mount prefixes to their source module. This is intentionally
 * textual and one-level: the runtime tree does not retain the file that
 * created a router, so the mount declaration is the best available source.
 * Longest prefix wins.
 */
export function buildMountMap(appSource) {
  const imports = new Map();

  const named = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  for (const match of String(appSource).matchAll(named)) {
    const module = moduleFromSpecifier(match[2]);
    if (!module) continue;
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imports.set(name, module);
    }
  }

  const defaults = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']([^"']+)["']/g;
  for (const match of String(appSource).matchAll(defaults)) {
    const module = moduleFromSpecifier(match[2]);
    if (module) imports.set(match[1], module);
  }

  const entries = [];
  const use = /app\.use\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*,([^;]*?)\)/g;
  for (const match of String(appSource).matchAll(use)) {
    const literal = match[1] || match[2] || null;
    const pathVariable = match[3] || null;
    const args = match[4] || "";
    const identifiers = [...args.matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,)]|$)/g)].map((m) => m[1]);
    const module = identifiers.map((name) => imports.get(name)).filter(Boolean).pop();
    if (!module) continue;
    // PAYSTACK_WEBHOOK_PATH is the one variable mount; its default is stable.
    const prefix = literal || (pathVariable === "PAYSTACK_WEBHOOK_PATH" ? "/api/webhooks/paystack" : null);
    if (!prefix) continue;
    entries.push({ prefix: normalizePath(prefix), module });
  }

  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return entries;
}

export function sourceModuleFor(fullPath, mountMap) {
  for (const entry of mountMap) {
    if (prefixApplies(fullPath, entry.prefix)) return entry.module;
  }
  return fullPath.startsWith("/api/") || fullPath === "/api" ? "unknown" : "app";
}

function walkRouter(router, basePrefix, inherited, out, mountMap) {
  const stack = router?.stack;
  if (!Array.isArray(stack)) return;
  const pending = [];

  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const own = (layer.route.stack || []).map((item) => item.name).filter(Boolean);
      const methods = Object.keys(layer.route.methods || {}).filter(
        (method) => HTTP_METHODS.has(method) && layer.route.methods[method],
      );

      for (const routePath of paths) {
        const fullPath = joinPaths(basePrefix, routePath);
        const middleware = [...inherited];
        for (const entry of pending) {
          if (prefixApplies(fullPath, entry.mount)) addMiddleware(middleware, entry.name);
        }
        for (const name of own) addMiddleware(middleware, name);

        for (const method of methods) {
          out.push({
            method: method.toUpperCase(),
            path: fullPath,
            middleware,
            sourceModule: sourceModuleFor(fullPath, mountMap),
          });
        }
      }
      continue;
    }

    const mount = layerMount(layer);
    const fullMount = joinPaths(basePrefix, mount);

    if (layer.handle?.stack) {
      const inheritedHere = [...inherited];
      for (const entry of pending) {
        if (prefixApplies(fullMount, entry.mount)) addMiddleware(inheritedHere, entry.name);
      }
      walkRouter(layer.handle, fullMount, inheritedHere, out, mountMap);
      continue;
    }

    if (typeof layer.handle === "function" && layer.handle.length < 4) {
      const name = layer.handle.name || layer.name;
      if (name && !GENERIC_MIDDLEWARE.has(name)) {
        pending.push({ mount: fullMount, name });
      }
    }
  }
}

function dedupeRoutes(routes) {
  const merged = new Map();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const existing = merged.get(key);
    if (existing) {
      for (const name of route.middleware) addMiddleware(existing.middleware, name);
      existing.occurrences += 1;
      continue;
    }
    merged.set(key, { ...route, occurrences: 1 });
  }
  return [...merged.values()].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}

/** Extract a normalized, deduplicated route table from a live Express app. */
export function extractRoutes(app, { appSource = "", mountMap } = {}) {
  const router = app?._router || app?.router;
  if (!router) throw new Error("extractRoutes: the Express app has no router stack (is app._router available?)");
  const out = [];
  walkRouter(router, "", [], out, mountMap || buildMountMap(appSource));
  return dedupeRoutes(out);
}

/** Convert an OpenAPI path (`/courses/{idOrSlug}`) to Express style. */
export function normalizeOpenApiPath(openApiPath) {
  let path = String(openApiPath || "/").trim();
  if (!path.startsWith("/")) path = `/${path}`;
  if (!(path === "/api" || path.startsWith("/api/"))) path = `/api${path}`;
  return normalizePath(path.replace(/\{([^}]+)\}/g, ":$1"));
}

/**
 * Minimal OpenAPI paths reader (no YAML dependency). Returns one row per
 * operation: method, openApiPath, path, operationId.
 */
export function parseOpenApi(text) {
  const lines = String(text).split(/\r?\n/);
  const operations = [];
  let inPaths = false;
  let currentPath = null;

  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; currentPath = null; continue; }
    if (inPaths && /^[^\s#]/.test(line)) { inPaths = false; currentPath = null; continue; }
    if (!inPaths) continue;

    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) { currentPath = pathMatch[1]; continue; }

    const methodMatch = line.match(/^    (get|post|put|patch|delete|options|head):\s*$/i);
    if (methodMatch && currentPath) {
      operations.push({
        method: methodMatch[1].toUpperCase(),
        openApiPath: currentPath,
        path: normalizeOpenApiPath(currentPath),
        operationId: null,
      });
      continue;
    }

    const operationId = line.match(/^      operationId:\s*([^\s#]+)/);
    if (operationId && operations.length) {
      const last = operations[operations.length - 1];
      if (!last.operationId) last.operationId = operationId[1];
    }
  }

  return operations;
}

/** Small RFC-4180-ish CSV reader for the audit inventories. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text);

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
      continue;
    }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1)
    .filter((values) => values.some((value) => value.trim() !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const routeKey = (route) => `${route.method} ${normalizePath(route.path)}`;

/**
 * Compare the runtime route table with OpenAPI and the public candidate list.
 *
 * - documented: every OpenAPI operation, marked present/absent in the runtime.
 * - missingDocumented: docs entries with no runtime route (a real docs bug).
 * - undocumentedPublic: public candidates with no OpenAPI operation.
 * - undocumentedRuntimeByModule: counts of runtime routes not documented.
 */
export function compareRouteTables({ runtime, openapi, publicCandidates = [] }) {
  const runtimeByKey = new Map(runtime.map((route) => [routeKey(route), route]));
  const openapiKeys = new Set(openapi.map(routeKey));

  const documented = openapi.map((operation) => {
    const runtimeRoute = runtimeByKey.get(routeKey(operation));
    return {
      ...operation,
      inRuntime: Boolean(runtimeRoute),
      runtimePath: runtimeRoute?.path || null,
      sourceModule: runtimeRoute?.sourceModule || null,
    };
  });

  const missingDocumented = documented.filter((operation) => !operation.inRuntime);

  const publicRoutes = publicCandidates
    .filter((candidate) => String(candidate.class || "").trim() === "public")
    .map((candidate) => ({
      method: String(candidate.method || "").toUpperCase(),
      path: normalizePath(String(candidate.path || "")),
      module: candidate.module || null,
      notes: candidate.notes || "",
    }));

  const undocumentedPublic = publicRoutes.filter((route) => !openapiKeys.has(routeKey(route)));

  const undocumentedRuntime = runtime.filter((route) => !openapiKeys.has(routeKey(route)));
  const byModule = new Map();
  for (const route of undocumentedRuntime) {
    const key = route.sourceModule || "unknown";
    byModule.set(key, (byModule.get(key) || 0) + 1);
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      runtimeRoutes: runtime.length,
      runtimePaths: new Set(runtime.map((route) => route.path)).size,
      documentedOperations: openapi.length,
      documentedPaths: new Set(openapi.map((route) => route.path)).size,
      documentedInRuntime: documented.length - missingDocumented.length,
      missingDocumented: missingDocumented.length,
      publicCandidates: publicRoutes.length,
      publicDocumented: publicRoutes.length - undocumentedPublic.length,
      publicWithoutDocs: undocumentedPublic.length,
      undocumentedRuntime: undocumentedRuntime.length,
    },
    documented,
    missingDocumented,
    publicRoutes,
    undocumentedPublic,
    undocumentedRuntimeByModule: [...byModule.entries()]
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module)),
  };
}
