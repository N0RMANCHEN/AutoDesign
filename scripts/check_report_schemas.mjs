import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function describe(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function validateValue(value, schema, fieldPath, failures) {
  if (schema.type === "object") {
    if (!isPlainObject(value)) {
      failures.push(`${fieldPath} must be an object, got ${describe(value)}`);
      return;
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        failures.push(`${fieldPath}.${key} is required`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          failures.push(`${fieldPath}.${key} is not allowed`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateValue(value[key], propertySchema, `${fieldPath}.${key}`, failures);
      }
    }
    return;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      failures.push(`${fieldPath} must be a string, got ${describe(value)}`);
      return;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      failures.push(`${fieldPath} must have length >= ${schema.minLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      failures.push(`${fieldPath} does not match pattern ${schema.pattern}`);
    }
    if ("const" in schema && value !== schema.const) {
      failures.push(`${fieldPath} must equal ${JSON.stringify(schema.const)}`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      failures.push(`${fieldPath} must be one of ${schema.enum.join(", ")}`);
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      failures.push(`${fieldPath} must be an array, got ${describe(value)}`);
      return;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      failures.push(`${fieldPath} must have at least ${schema.minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        validateValue(item, schema.items, `${fieldPath}[${index}]`, failures);
      });
    }
    return;
  }
}

async function collectJsonFiles(relativeDir) {
  const dirPath = path.join(root, relativeDir);
  if (!existsSync(dirPath)) {
    return [];
  }
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(relativeDir, entry.name));
}

async function validateAgainstSchema(schemaPath, filePaths, failures) {
  const schema = JSON.parse(await readFile(path.join(root, schemaPath), "utf8"));
  for (const filePath of filePaths) {
    try {
      const value = JSON.parse(await readFile(path.join(root, filePath), "utf8"));
      validateValue(value, schema, filePath, failures);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${filePath} failed to parse: ${message}`);
    }
  }
}

async function main() {
  const failures = [];

  const acceptanceSchemaPath = "schemas/acceptance-report.schema.json";
  const qualitySchemaPath = "schemas/quality-report.schema.json";

  if (!existsSync(path.join(root, acceptanceSchemaPath))) {
    failures.push(`missing schema: ${acceptanceSchemaPath}`);
  }
  if (!existsSync(path.join(root, qualitySchemaPath))) {
    failures.push(`missing schema: ${qualitySchemaPath}`);
  }

  const acceptanceFiles = await collectJsonFiles("reports/acceptance");
  const qualityFiles = await collectJsonFiles("reports/quality");

  if (existsSync(path.join(root, acceptanceSchemaPath))) {
    await validateAgainstSchema(acceptanceSchemaPath, acceptanceFiles, failures);
  }
  if (existsSync(path.join(root, qualitySchemaPath))) {
    await validateAgainstSchema(qualitySchemaPath, qualityFiles, failures);
  }

  if (failures.length > 0) {
    console.error("check:report-schemas failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `check:report-schemas passed (${acceptanceFiles.length} acceptance JSON, ${qualityFiles.length} quality JSON)`,
  );
}

await main();
