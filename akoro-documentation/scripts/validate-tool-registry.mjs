#!/usr/bin/env node
/**
 * Phase 3 tool-registry validator.
 *
 * Ensures the agent tool registry stays aligned with the capability registry,
 * the documentation tree and the OpenAPI contract:
 *   - every tool capability ID exists;
 *   - every documentation and API reference resolves;
 *   - permission and confirmation metadata is present and consistent;
 *   - tool IDs are unique;
 *   - a tool cannot claim wider access than its capability.
 *
 * Run from the repository root or from akoro-documentation:
 *   node akoro-documentation/scripts/validate-tool-registry.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  docRoot,
  isMain,
  isNonEmptyString,
  isPlainObject,
  loadYamlModule,
  readYamlFile,
} from "./lib.mjs";

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const REGISTRY_KEYS = new Set([
  "schema_version",
  "platform",
  "updated",
  "description",
  "tools",
]);
const TOOL_KEYS = new Set([
  "id",
  "name",
  "description",
  "capability",
  "execution_mode",
  "input_schema",
  "documentation",
  "api_reference",
  "permissions",
  "side_effects",
  "notes",
  "internal_reason",
]);
const PERMISSION_KEYS = new Set([
  "access",
  "requires_authentication",
  "requires_confirmation",
  "confirmation_reason",
]);
const API_REFERENCE_KEYS = new Set(["openapi", "method", "path", "operation_id"]);
const TOOL_ID = /^[a-z][a-z0-9_]*$/;
const CAPABILITY_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

function safeRelativePath(value) {
  if (!isNonEmptyString(value)) return false;
  if (path.isAbsolute(value)) return false;
  if (value.split(/[\\/]/).includes("..")) return false;
  return true;
}

function checkDocumentationRefs(refs, label, root, errors) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${label}: documentation must be a non-empty array`);
    return;
  }
  const seen = new Set();
  for (const [index, ref] of refs.entries()) {
    const at = `${label}: documentation[${index}]`;
    if (!safeRelativePath(ref)) {
      errors.push(`${at}: must be a repository-relative path inside akoro-documentation`);
      continue;
    }
    if (seen.has(ref)) errors.push(`${at}: duplicate documentation reference ${ref}`);
    seen.add(ref);
    if (!fs.existsSync(path.join(root, ref))) errors.push(`${at}: missing file ${ref}`);
  }
}

function checkRequired(required, properties, label, errors) {
  if (required === undefined) return;
  if (!Array.isArray(required)) {
    errors.push(`${label}: required must be an array`);
    return;
  }
  for (const name of required) {
    if (!isNonEmptyString(name)) {
      errors.push(`${label}: required entries must be non-empty strings`);
      continue;
    }
    if (!(name in properties)) {
      errors.push(`${label}: required property '${name}' is not declared in properties`);
    }
  }
}

function checkInputSchema(schema, label, errors) {
  if (!isPlainObject(schema)) {
    errors.push(`${label}: input_schema must be an object`);
    return;
  }
  if (
    !isNonEmptyString(schema.type) &&
    schema.$ref === undefined &&
    schema.oneOf === undefined &&
    schema.anyOf === undefined &&
    schema.allOf === undefined
  ) {
    errors.push(`${label}: input_schema must declare a type, $ref or composition`);
  }
  const rootProperties = isPlainObject(schema.properties) ? schema.properties : {};
  checkRequired(schema.required, rootProperties, `${label}: input_schema`, errors);

  for (const key of ["oneOf", "anyOf", "allOf"]) {
    if (schema[key] === undefined) continue;
    if (!Array.isArray(schema[key])) {
      errors.push(`${label}: input_schema.${key} must be an array`);
      continue;
    }
    schema[key].forEach((branch, index) => {
      const at = `${label}: input_schema.${key}[${index}]`;
      if (!isPlainObject(branch)) {
        errors.push(`${at}: branch must be an object`);
        return;
      }
      const branchProperties = {
        ...rootProperties,
        ...(isPlainObject(branch.properties) ? branch.properties : {}),
      };
      checkRequired(branch.required, branchProperties, at, errors);
    });
  }
}

function checkApiReferences(refs, label, root, openapi, errors) {
  if (!Array.isArray(refs) || refs.length === 0) {
    errors.push(`${label}: api_reference must be a non-empty array for http tools`);
    return;
  }
  for (const [index, ref] of refs.entries()) {
    const at = `${label}: api_reference[${index}]`;
    if (!isPlainObject(ref)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    for (const key of Object.keys(ref)) {
      if (!API_REFERENCE_KEYS.has(key)) errors.push(`${at}: unknown field '${key}'`);
    }
    if (!safeRelativePath(ref.openapi)) {
      errors.push(`${at}: openapi must be a repository-relative path inside akoro-documentation`);
    } else if (!fs.existsSync(path.join(root, ref.openapi))) {
      errors.push(`${at}: missing OpenAPI file ${ref.openapi}`);
    }
    if (!METHODS.has(ref.method)) {
      errors.push(`${at}: invalid method '${ref.method}'`);
    }
    if (!isNonEmptyString(ref.path) || !ref.path.startsWith("/")) {
      errors.push(`${at}: path must start with '/'`);
    }
    if (ref.operation_id !== undefined && !isNonEmptyString(ref.operation_id)) {
      errors.push(`${at}: operation_id must be a non-empty string when present`);
    }
    if (!openapi || !isNonEmptyString(ref.path)) continue;
    const pathItem = openapi.paths?.[ref.path];
    if (!pathItem) {
      errors.push(`${at}: OpenAPI has no path ${ref.path}`);
      continue;
    }
    const operation = pathItem[ref.method];
    if (!operation) {
      errors.push(`${at}: OpenAPI has no ${String(ref.method).toUpperCase()} ${ref.path}`);
      continue;
    }
    if (ref.operation_id && operation.operationId !== ref.operation_id) {
      errors.push(
        `${at}: operation_id '${ref.operation_id}' does not match OpenAPI '${operation.operationId}'`,
      );
    }
  }
}

function checkPermissions(permissions, label, capability, errors) {
  if (!isPlainObject(permissions)) {
    errors.push(`${label}: permissions must be an object`);
    return;
  }
  for (const key of Object.keys(permissions)) {
    if (!PERMISSION_KEYS.has(key)) errors.push(`${label}: unknown permission field '${key}'`);
  }
  if (!Array.isArray(permissions.access) || permissions.access.length === 0) {
    errors.push(`${label}: permissions.access must be a non-empty array`);
  } else {
    const seen = new Set();
    for (const access of permissions.access) {
      if (!isNonEmptyString(access)) {
        errors.push(`${label}: permissions.access entries must be non-empty strings`);
        continue;
      }
      if (seen.has(access)) errors.push(`${label}: duplicate access '${access}'`);
      seen.add(access);
    }
  }
  if (typeof permissions.requires_authentication !== "boolean") {
    errors.push(`${label}: permissions.requires_authentication must be a boolean`);
  }
  if (typeof permissions.requires_confirmation !== "boolean") {
    errors.push(`${label}: permissions.requires_confirmation must be a boolean`);
  }
  if (!("confirmation_reason" in permissions)) {
    errors.push(`${label}: permissions.confirmation_reason is required`);
  } else if (
    permissions.requires_confirmation === true &&
    !isNonEmptyString(permissions.confirmation_reason)
  ) {
    errors.push(
      `${label}: permissions.confirmation_reason must be set when requires_confirmation is true`,
    );
  } else if (
    permissions.confirmation_reason !== null &&
    !isNonEmptyString(permissions.confirmation_reason)
  ) {
    errors.push(`${label}: permissions.confirmation_reason must be null or a non-empty string`);
  }

  if (!capability) return;
  const capabilityAccess = new Set(Array.isArray(capability.access) ? capability.access : []);
  if (Array.isArray(permissions.access)) {
    for (const access of permissions.access) {
      if (isNonEmptyString(access) && !capabilityAccess.has(access)) {
        errors.push(
          `${label}: access '${access}' is not granted by capability ${capability.id}`,
        );
      }
    }
    const publicOnly =
      permissions.access.length === 1 && permissions.access[0] === "public";
    if (publicOnly && permissions.requires_authentication === true) {
      errors.push(`${label}: a public-only tool cannot require authentication`);
    }
    if (!publicOnly && permissions.requires_authentication === false) {
      errors.push(`${label}: a non-public tool must require authentication`);
    }
  }
  if (capability.requires_confirmation === true && permissions.requires_confirmation !== true) {
    errors.push(
      `${label}: capability ${capability.id} requires confirmation but the tool does not`,
    );
  }
}

function checkTool(tool, index, context) {
  const { root, openapi, capabilities, errors } = context;
  const labelBase = `tool-registry.yaml: tools[${index}]`;
  if (!isPlainObject(tool)) {
    errors.push(`${labelBase}: must be an object`);
    return null;
  }
  const label = isNonEmptyString(tool.id) ? `tool ${tool.id}` : labelBase;
  for (const key of Object.keys(tool)) {
    if (!TOOL_KEYS.has(key)) errors.push(`${label}: unknown field '${key}'`);
  }

  if (!isNonEmptyString(tool.id) || !TOOL_ID.test(tool.id)) {
    errors.push(`${label}: id must match ${TOOL_ID}`);
  }
  if (!isNonEmptyString(tool.name)) errors.push(`${label}: name must be a non-empty string`);
  if (!isNonEmptyString(tool.description)) {
    errors.push(`${label}: description must be a non-empty string`);
  }

  let capability = null;
  if (!isNonEmptyString(tool.capability) || !CAPABILITY_ID.test(tool.capability)) {
    errors.push(`${label}: capability must be a valid capability id`);
  } else {
    capability = capabilities.get(tool.capability) || null;
    if (!capability) {
      errors.push(`${label}: capability '${tool.capability}' does not exist in capability-registry.yaml`);
    } else if (capability.status === "planned" || capability.status === "disabled") {
      errors.push(`${label}: capability '${tool.capability}' is ${capability.status} and cannot have a tool`);
    }
  }

  if (!["http", "internal"].includes(tool.execution_mode)) {
    errors.push(`${label}: execution_mode must be 'http' or 'internal'`);
  }
  checkInputSchema(tool.input_schema, label, errors);
  checkDocumentationRefs(tool.documentation, label, root, errors);

  if (tool.execution_mode === "http") {
    checkApiReferences(tool.api_reference, label, root, openapi, errors);
  } else if (tool.execution_mode === "internal") {
    if (!isNonEmptyString(tool.internal_reason)) {
      errors.push(`${label}: internal tools require internal_reason`);
    }
    if (tool.api_reference !== undefined) {
      checkApiReferences(tool.api_reference, label, root, openapi, errors);
    }
  }

  checkPermissions(tool.permissions, label, capability, errors);

  if (tool.side_effects !== undefined) {
    if (!Array.isArray(tool.side_effects)) {
      errors.push(`${label}: side_effects must be an array`);
    } else {
      for (const effect of tool.side_effects) {
        if (!isNonEmptyString(effect)) {
          errors.push(`${label}: side_effects entries must be non-empty strings`);
        }
      }
    }
  }
  if (tool.notes !== undefined && !isNonEmptyString(tool.notes)) {
    errors.push(`${label}: notes must be a non-empty string when present`);
  }
  return tool;
}

/**
 * Validate tool-registry.yaml. Returns errors plus counts for callers that
 * summarise the documentation system (validate-docs.mjs).
 */
export function collectToolRegistryErrors({
  root = docRoot,
  YAML = loadYamlModule(),
  index,
  registry,
  openapi,
  toolRegistry,
} = {}) {
  const errors = [];
  const toolDoc =
    toolRegistry === undefined
      ? readYamlFile(root, "tool-registry.yaml", errors, YAML)
      : toolRegistry;
  const capabilityRegistry =
    registry === undefined
      ? readYamlFile(root, "capability-registry.yaml", errors, YAML)
      : registry;
  const openapiDoc =
    openapi === undefined
      ? readYamlFile(root, "02-api/openapi.yaml", errors, YAML)
      : openapi;

  const capabilities = new Map();
  for (const capability of capabilityRegistry?.capabilities || []) {
    if (isNonEmptyString(capability?.id)) capabilities.set(capability.id, capability);
  }

  if (!toolDoc) {
    return { errors, tools: [], toolCount: 0, capabilityCount: capabilities.size, index };
  }
  if (!isPlainObject(toolDoc)) {
    errors.push("tool-registry.yaml: root must be an object");
    return { errors, tools: [], toolCount: 0, capabilityCount: capabilities.size, index };
  }
  for (const key of Object.keys(toolDoc)) {
    if (!REGISTRY_KEYS.has(key)) errors.push(`tool-registry.yaml: unknown field '${key}'`);
  }
  if (toolDoc.schema_version !== "1.0") {
    errors.push("tool-registry.yaml: schema_version must be '1.0'");
  }
  if (toolDoc.platform !== "Akoro") {
    errors.push("tool-registry.yaml: platform must be 'Akoro'");
  }
  if (!Array.isArray(toolDoc.tools) || toolDoc.tools.length === 0) {
    errors.push("tool-registry.yaml: tools must be a non-empty array");
    return { errors, tools: [], toolCount: 0, capabilityCount: capabilities.size, index };
  }

  const tools = [];
  const ids = new Set();
  toolDoc.tools.forEach((tool, index) => {
    const checked = checkTool(tool, index, { root, openapi: openapiDoc, capabilities, errors });
    if (!checked) return;
    tools.push(checked);
    if (isNonEmptyString(checked.id)) {
      if (ids.has(checked.id)) errors.push(`tool ${checked.id}: duplicate id`);
      ids.add(checked.id);
    }
  });

  return {
    errors,
    tools,
    toolCount: tools.length,
    capabilityCount: capabilities.size,
    index,
  };
}

if (isMain(import.meta.url)) {
  const result = collectToolRegistryErrors();
  if (result.errors.length) {
    console.error(`Tool registry validation failed (${result.errors.length}):`);
    for (const error of [...new Set(result.errors)]) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `Tool registry validation passed: ${result.toolCount} tools across ` +
      `${result.capabilityCount} capabilities.`,
  );
}
