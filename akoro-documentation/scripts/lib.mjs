import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const docRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = path.resolve(docRoot, "..");

let cachedYaml = null;

/**
 * Resolve the `yaml` package from the repository without assuming a working
 * directory. The documentation system deliberately has no package.json of its
 * own; it borrows the dependency already used by akoro-docs.
 */
export function loadYamlModule() {
  if (cachedYaml) return cachedYaml;
  const candidates = [
    path.join(repoRoot, "akoro-docs", "package.json"),
    path.join(docRoot, "package.json"),
    path.join(repoRoot, "package.json"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      cachedYaml = createRequire(candidate)("yaml");
      return cachedYaml;
    } catch {
      // Try the next candidate.
    }
  }
  try {
    cachedYaml = createRequire(import.meta.url)("yaml");
    return cachedYaml;
  } catch {
    throw new Error(
      "Cannot resolve the 'yaml' package. Run from the repository after installing akoro-docs dependencies.",
    );
  }
}

export function readJsonFile(root, file, errors) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
}

export function readYamlFile(root, file, errors, YAML = loadYamlModule()) {
  try {
    return YAML.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch (err) {
    errors.push(`${file}: ${err.message}`);
    return null;
  }
}

export function rel(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
