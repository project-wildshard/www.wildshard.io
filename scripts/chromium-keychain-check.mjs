// Conservative source guard for Chromium launchers, without a parser dependency.
const childMethods = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'];
const browserBinary = /chrom(?:e|ium)|executablePath\s*\(/iu;

/** A literal shell executable or a named executable variable must carry both flags. */
function shellProblems(/** @type {string} */ text) {
  if (!/^#![^\n]*\b(?:ba|z|da)?sh\b/u.test(text)) return [];
  const variables = new Map([...text.matchAll(/^\s*(\w+)=(?:['"]([^'"\n]+)['"]|([^\s\n]+))/gmu)].map(match => [match[1], match[2] ?? match[3]]));
  return text.replace(/\\\n\s*/gu, ' ').split('\n').flatMap(line => {
    const command = /^\s*(?:exec\s+)?("[^"]+"|'[^']+'|[^\s;]+)(.*)$/u.exec(line);
    if (!command || command[1].startsWith('#') || command[1].includes('=')) return [];
    const program = command[1].replace(/\$\{?(\w+)\}?/gu, (_all, name) => variables.get(name) ?? name);
    if (!browserBinary.test(program)) return [];
    return ['--use-mock-keychain', '--password-store=basic'].every(flag => command[2].includes(flag)) ? [] : ['bare Chromium shell executable'];
  });
}

// Keep offsets while preventing examples, comments and generated source strings
// from being mistaken for executable calls in the containing file.
function codeMask(/** @type {string} */ text) {
  let quote = '', escaped = false, line = false, block = false;
  let regex = false, characterClass = false;
  return text.split('').map((char, index) => {
    const next = text[index + 1];
    if (line) { if (char === '\n') line = false; return char === '\n' ? char : ' '; }
    if (block) { if (char === '*' && next === '/') block = false; return ' '; }
    if (regex) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '[') characterClass = true;
      else if (char === ']') characterClass = false;
      else if (char === '/' && !characterClass) regex = false;
      return ' ';
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      return char === '\n' ? char : ' ';
    }
    if (char === '/' && next === '/') { line = true; return ' '; }
    if (char === '/' && next === '*') { block = true; return ' '; }
    if (char === '/' && /(?:^|[=(:,![?&|{};]|=>|\breturn|\bcase)\s*$/u.test(text.slice(Math.max(0, index - 30), index))) {
      regex = true; return ' ';
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; return ' '; }
    return char;
  }).join('');
}

/** Read a balanced expression, retaining strings but ignoring their punctuation. */
function expression(/** @type {string} */ text, /** @type {number} */ start, stopAtComma = false) {
  let depth = 0, quote = '', escaped = false, i = start;
  for (; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) return text.length; continue; }
    if (char === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) { if (depth === 0) break; depth--; }
    if (depth === 0 && (char === ';' || stopAtComma && char === ',')) break;
  }
  return i;
}

/** Return actionable failures; aliases keep raw executable spawns visible. */
export function keychainProblems(/** @type {string} */ text) {
  const problems = shellProblems(text);
  const code = codeMask(text);
  let ownsSafeChromium = false;
  if (text.includes('ignore' + 'DefaultArgs')) problems.push('drops Playwright default arguments');
  const bindings = new Map();
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu)) {
    const start = match.index + match[0].length;
    bindings.set(match[1], text.slice(start, expression(text, start, true)));
  }
  const expand = (/** @type {string} */ value) => {
    const seen = new Set();
    for (let pass = 0; pass < 12; pass++) {
      let changed = false;
      const mask = codeMask(value);
      value = value.replace(/\b[A-Za-z_$][\w$]*\b/gu, (name, offset) => {
        if (mask[offset] === ' ' && value.slice(offset - 2, offset) !== '${') return name;
        if (name === 'KEYCHAIN_ARGS' || seen.has(name) || !bindings.has(name)) return name;
        seen.add(name); changed = true; return `(${bindings.get(name)})`;
      });
      if (!changed) break;
    }
    return value;
  };
  const safe = (/** @type {string} */ value) => /\.\.\.\s*KEYCHAIN_ARGS\b/u.test(expand(value))
    || ['--use-mock-keychain', '--password-store=basic'].every(flag => expand(value).includes(flag));
  const names = [...childMethods];
  const namespaces = new Set([...text.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"](?:node:)?child_process['"]/gu)].map(match => match[1]));
  for (const match of text.matchAll(/import\s+(\w+)\s+from\s+['"](?:node:)?child_process['"]/gu)) namespaces.add(match[1]);
  for (const match of text.matchAll(/\b(spawn(?:Sync)?|execFile(?:Sync)?|exec(?:Sync)?)\s+(?:as\s+|:\s*)(\w+)/gu)) names.push(match[2]);
  for (const match of text.matchAll(/\b(spawn(?:Sync)?|execFile(?:Sync)?|exec(?:Sync)?)\s*:\s*(\w+)/gu)) names.push(match[2]);
  const childCall = new RegExp(`\\b(?:${names.join('|')})\\s*\\(`, 'gu');
  let childCode = code;
  for (const match of text.matchAll(/(\brequire\s*\(\s*['"](?:node:)?child_process['"]\s*\)|\b\w+)\s*\[\s*['"](spawn(?:Sync)?|execFile(?:Sync)?|exec(?:Sync)?)['"]\s*\]\s*\(/gu)) {
    if (code[match.index] === ' ' || !/child_process/u.test(expand(match[1])) && !namespaces.has(match[1])) continue;
    const replacement = ' '.repeat(match[0].length - match[2].length - 1) + match[2] + '(';
    childCode = childCode.slice(0, match.index) + replacement + childCode.slice(match.index + match[0].length);
  }
  for (const match of childCode.matchAll(childCall)) {
    const receiver = /(\w+)\s*\.\s*$/u.exec(code.slice(Math.max(0, match.index - 80), match.index))?.[1];
    if (receiver && !namespaces.has(receiver) && !/child_process/u.test(expand(receiver))) continue;
    const start = match.index + match[0].length;
    const first = text.slice(start, expression(text, start, true));
    const call = text.slice(start, expression(text, start));
    if (browserBinary.test(expand(first))) {
      if (safe(call)) ownsSafeChromium = true;
      else problems.push(`bare Chromium child process at offset ${match.index}`);
    }
  }
  if (/playwright/u.test(text) && /chromium|Desktop Chrome/u.test(text)) {
    for (const match of code.matchAll(/\.\s*(?:launch|launchPersistentContext|launchServer)\s*\(/gu)) {
      const before = text.slice(Math.max(0, match.index - 20), match.index);
      if (/\bwebkit\s*$/u.test(before)) continue;
      // A typed injected author host is an interface call, not a browser start.
      const receiver = /\b(\w+)\s*$/u.exec(before)?.[1];
      if (receiver && new RegExp(`\\b${receiver}\\s*:\\s*NativeRasterHost\\b`, 'u').test(text)) continue;
      const start = match.index + match[0].length;
      if (!safe(text.slice(start, expression(text, start)))) problems.push(`bare Playwright launch at offset ${match.index}`);
      else ownsSafeChromium = true;
    }
    if (/\.\s*(?:connect|connectOverCDP)\s*\(/u.test(code) && !ownsSafeChromium
      && (!text.includes('Browser.getBrowserCommandLine') || !text.includes('KEYCHAIN_ARGS.every'))) problems.push('Chromium attachment must verify the connected process command line');
    if (/\bdefineConfig\s*\(/u.test(code) && /Desktop Chrome/u.test(text)
      && !/launchOptions\s*:\s*\{\s*args\s*:\s*\[\s*\.\.\.KEYCHAIN_ARGS/u.test(text)) problems.push('Desktop Chrome project lacks safe launchOptions');
  }
  return problems;
}
