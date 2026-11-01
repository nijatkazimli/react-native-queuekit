#!/usr/bin/env node
// Writes the package version where the docs site reads it. Runs from the npm `version` lifecycle script.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync("docs/assets/version.json", `${JSON.stringify({ version })}\n`);
console.log(`docs version set to ${version}`);
