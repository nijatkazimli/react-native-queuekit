#!/usr/bin/env node
// Prints markdown release notes for a tag: the commit subjects since the previous tag, grouped by type.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node scripts/release-notes.mjs <tag>");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const tags = git("tag", "--list", "v*", "--sort=-v:refname").split("\n").filter(Boolean);
if (!tags.includes(tag)) {
  console.error(`Unknown tag: ${tag}`);
  process.exit(1);
}
const previous = tags[tags.indexOf(tag) + 1];

const GROUPS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["other", "Maintenance"],
];
const grouped = new Map(GROUPS.map(([type]) => [type, []]));

const log = git("log", "--no-merges", "--format=%h\t%s", previous ? `${previous}..${tag}` : tag);
for (const line of log.split("\n").filter(Boolean)) {
  const [hash, subject] = line.split("\t");
  if (/^\d+\.\d+\.\d+/.test(subject)) continue; // the version bump commit
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?!?: (.+)$/);
  const type = match && grouped.has(match[1]) ? match[1] : "other";
  const text = match ? `${match[2] ? `**${match[2]}:** ` : ""}${match[3]}` : subject;
  grouped.get(type).push(`- ${text} (${hash})`);
}

const sections = GROUPS.filter(([type]) => grouped.get(type).length).map(
  ([type, title]) => `### ${title}\n\n${grouped.get(type).join("\n")}`,
);
const { repository } = JSON.parse(readFileSync("package.json", "utf8"));
const repo = repository.url.match(/github\.com\/(.+?)(?:\.git)?$/)[1];
const compare = previous
  ? `https://github.com/${repo}/compare/${previous}...${tag}`
  : `https://github.com/${repo}/commits/${tag}`;

console.log(`${sections.join("\n\n")}\n\n**Full Changelog**: ${compare}`);
