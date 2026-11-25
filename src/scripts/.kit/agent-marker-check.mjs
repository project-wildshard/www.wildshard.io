#!/usr/bin/env node
// MT3. Run on a checkout's operator scripts and workflow files. Product code
// and web application bundles are outside this check.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const host = /\b(?:https?|wss?):\/\/(?:[\w-]+\.)*wildshard\.io(?=[:/?"'`\s]|$)/iu;
const network = /(?<![\w.])(?:fetch|WebSocket)\s*\((?!\s*['"`]\/(?!\/))/u;
const browser = /\.(?:launch|launchPersistentContext|connectOverCDP)\s*\(|\b(?:agent-browser\s+open|simctl\b[^\n]*\bopenurl)\b/u;
const nodeMarker = /(?:agent-(?:fetch|requests)\.mjs|\bmarkedFetch\s*\(|\bagentHeaders\s*\()/u;
const browserMarker = /(?:browser-playwright\.mjs|installBrowserActorMarker\s*\(|\bagentUrl\s*\(|[?&]agent=|--user-agent\b[^\n]*WildshardAgent\/1)/u;
const files = /\.(?:[cm]?[jt]s|sh|ya?ml|py)$/u;

/** @param {string} source @param {string} path */
export function markerIssues(source, path) {
  const issues = [];
  if (/\bextraHTTPHeaders\s*:\s*(?:\{[^}]*|[^\n,]*)(?:x-wildshard-agent|agentHeaders\s*\()/iu.test(source)) {
    issues.push('keep the actor header out of browser-wide request options');
  }
  const logicalLines = source.replaceAll(/\\\r?\n[ \t]*/gu, ' ').split('\n');
  const hostedVariables = logicalLines.flatMap(line => {
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][\w]*)=.*$/u.exec(line);
    return assignment?.[1] !== undefined && host.test(line) ? [assignment[1]] : [];
  });
  for (const [index, line] of logicalLines.entries()) {
    const curl = /\bcurl\s+([^|;]*)/u.exec(line)?.[1];
    if (curl === undefined || line.trimStart().startsWith('#')) continue;
    const owned = host.test(curl) || hostedVariables.some(name => curl.includes(`\${${name}}`) || new RegExp(`\\$${name}(?!\\w)`, 'u').test(curl));
    if (owned && !/(?:-A|--user-agent)\s+(?:["']?\$\{?WS_AGENT_UA\b|["']?WildshardAgent\/1)/u.test(curl)) {
      issues.push(`curl at line ${index + 1} needs -A "$WS_AGENT_UA"`);
    }
  }
  if (!/\.(?:[cm]?[jt]s|py)$/u.test(path) || (!host.test(source) && !/from ['"][^'"]*api-origin\.mjs['"]/u.test(source))) return issues;
  const nativeInspector = path.endsWith('/webkit-mem-reading.mjs') && source.includes('agentUrl(flag(');
  if (network.test(source) && !nodeMarker.test(source) && !nativeInspector) issues.push('use the Node actor marker for hosted fetches and sockets');
  if (browser.test(source) && !browserMarker.test(source)) issues.push('use the marked browser helper or an actor-marked navigation');
  return issues;
}

/** @param {string} root */
export function checkMarkers(root) {
  const scopes = ['scripts', '.github/workflows', 'files/scripts', 'files/.github/workflows'];
  const problems = [];
  for (const relativeScope of scopes) {
    const scope = join(root, relativeScope);
    if (!existsSync(scope)) continue;
    for (const entry of readdirSync(scope, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !files.test(entry.name) || entry.name.startsWith('agent-marker')) continue;
      const full = join(entry.parentPath, entry.name);
      const path = relative(root, full);
      if (path.includes('/node_modules/')) continue;
      for (const problem of markerIssues(readFileSync(full, 'utf8'), path)) problems.push(`${path}: ${problem}`);
    }
  }
  return problems.sort();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : ['.'];
  for (const root of roots) {
    const problems = checkMarkers(resolve(root));
    if (problems.length > 0) {
      console.error(problems.map(problem => `${root}: ${problem}`).join('\n'));
      process.exitCode = 1;
    } else console.log(`agent-marker-check: ${root} ok`);
  }
}
