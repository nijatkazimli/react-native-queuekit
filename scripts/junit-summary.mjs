#!/usr/bin/env node
// Turns a Maestro JUnit report into a markdown summary for the GitHub Actions job page.
// Usage: node scripts/junit-summary.mjs report.xml [label] >> "$GITHUB_STEP_SUMMARY"
import { existsSync, readFileSync } from "node:fs";

const file = process.argv[2];
const heading = `## iOS end-to-end tests${process.argv[3] ? ` (${process.argv[3]})` : ""}`;
if (!file || !existsSync(file)) {
  console.log(`${heading}\n\nNo report was produced, so the flows did not finish.`);
  process.exit(0);
}

const xml = readFileSync(file, "utf8");
const decode = (text = "") =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const attr = (tag, name) => decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]);

const suite = xml.match(/<testsuite\b[^>]*>/)?.[0] ?? "";
const cases = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => {
  const body = m[2] ?? "";
  const failed = attr(m[1], "status") !== "SUCCESS" || /<(failure|error)\b/.test(body);
  const message = decode(
    body.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/)?.[1] ??
      body.match(/<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/)?.[1]?.trim(),
  );
  return {
    name: attr(m[1], "name"),
    flow: attr(m[1], "file").replace(/^\.maestro\//, ""),
    seconds: Number(attr(m[1], "time")) || 0,
    failed,
    message,
  };
});

const duration = (seconds) => {
  const total = Math.round(seconds);
  return total >= 60
    ? `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`
    : `${total}s`;
};
const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

const failed = cases.filter((c) => c.failed);
const byFlow = (a, b) => a.flow.localeCompare(b.flow);
const total = cases.reduce((sum, c) => sum + c.seconds, 0);
const device = attr(suite, "device");

const lines = [
  heading,
  "",
  failed.length
    ? `**${failed.length} failed**, ${cases.length - failed.length} passed`
    : `**All ${cases.length} flows passed**`,
  `in ${duration(total)}${device ? ` on ${device.replace(/ - [0-9A-F-]{36}$/, "")}` : ""}.`,
  "",
  "| Result | Flow | File | Time |",
  "| --- | --- | --- | ---: |",
  ...[...failed.sort(byFlow), ...cases.filter((c) => !c.failed).sort(byFlow)].map(
    (c) =>
      `| ${c.failed ? "**Failed**" : "Passed"} | ${cell(c.name)} | \`${c.flow}\` | ${duration(c.seconds)} |`,
  ),
];

if (failed.length) {
  lines.push("", "### Failures", "");
  for (const c of failed) {
    lines.push(`<details><summary>${cell(c.name)} (<code>${c.flow}</code>)</summary>`, "");
    lines.push("```", c.message || "No message in the report.", "```", "", "</details>", "");
  }
  lines.push("Screenshots and logs for every flow are in the `maestro-ios` artifact of this run.");
}

console.log(lines.join("\n"));
