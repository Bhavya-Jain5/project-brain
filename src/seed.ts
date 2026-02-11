/**
 * Seed script: Initialize schemas and load founding values + hard constraints into core.db
 * Run once after first build: node dist/seed.js
 */
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env") });

import { initializeAllSchemas } from "./db/schema.js";
import { getDb, closeAll } from "./db/connection.js";

// Initialize all schemas first
console.log("Initializing schemas for all databases...");
initializeAllSchemas();
console.log("Schemas initialized.");

// Load and run founding SQL files
const basePath = path.resolve(__dirname, "..", "..");
const foundingValuesPath = path.join(basePath, "FOUNDING_VALUES.sql");
const hardConstraintsPath = path.join(basePath, "HARD_CONSTRAINTS.sql");

const core = getDb("core");

// Check if founding values already loaded
const existingValues = core.prepare(
  "SELECT COUNT(*) as count FROM memories WHERE source = 'founding'"
).get() as { count: number };

if (existingValues.count > 0) {
  console.log(`Founding data already loaded (${existingValues.count} records). Skipping.`);
} else {
  // Load founding values
  if (fs.existsSync(foundingValuesPath)) {
    console.log("Loading FOUNDING_VALUES.sql...");
    const sql = fs.readFileSync(foundingValuesPath, "utf-8");
    // Remove SQL comments for execution
    const cleanSql = sql
      .split("\n")
      .filter(line => !line.trimStart().startsWith("--"))
      .join("\n");
    core.exec(cleanSql);
    const valueCount = core.prepare(
      "SELECT COUNT(*) as count FROM memories WHERE category = 'value'"
    ).get() as { count: number };
    console.log(`Loaded ${valueCount.count} founding values.`);
  } else {
    console.log(`WARNING: ${foundingValuesPath} not found`);
  }

  // Load hard constraints
  if (fs.existsSync(hardConstraintsPath)) {
    console.log("Loading HARD_CONSTRAINTS.sql...");
    const sql = fs.readFileSync(hardConstraintsPath, "utf-8");
    const cleanSql = sql
      .split("\n")
      .filter(line => !line.trimStart().startsWith("--"))
      .join("\n");
    core.exec(cleanSql);
    const constraintCount = core.prepare(
      "SELECT COUNT(*) as count FROM memories WHERE category = 'hard_constraint'"
    ).get() as { count: number };
    console.log(`Loaded ${constraintCount.count} hard constraints.`);
  } else {
    console.log(`WARNING: ${hardConstraintsPath} not found`);
  }
}

// Verify
console.log("\n--- Verification ---");
const values = core.prepare(
  "SELECT id, substr(content, 1, 60) as preview, subcategory FROM memories WHERE category = 'value'"
).all();
console.log(`\nFounding Values (${values.length}):`);
for (const v of values as Array<{ id: string; preview: string; subcategory: string }>) {
  console.log(`  ${v.id}: ${v.preview}...`);
}

const constraints = core.prepare(
  "SELECT id, subcategory, substr(content, 1, 60) as preview FROM memories WHERE category = 'hard_constraint'"
).all();
console.log(`\nHard Constraints (${constraints.length}):`);
for (const c of constraints as Array<{ id: string; preview: string; subcategory: string }>) {
  console.log(`  ${c.id} [${c.subcategory}]: ${c.preview}...`);
}

const totalFounding = core.prepare(
  "SELECT COUNT(*) as count FROM memories WHERE source = 'founding'"
).get() as { count: number };
console.log(`\nTotal founding records: ${totalFounding.count}`);

closeAll();
console.log("\nDone. Databases ready.");
