// The site's words (MARKETING-SITE, Jake 2026-10-09: "a single file I can go and hand edit"): every piece of text on the
// page lives in site/COPY.md under a `## Name` heading, and site/index.html holds only slots that name them.
//   {{Name}}        text, with inline markdown: **bold**, `code`, [links](url); a ✓ is drawn in the accent colour
//   {{@Name}}       an attribute (alt, aria-label, placeholder, meta content): plain text
//   {{$Name}}       a string in the page's script
//   {{list:Name}}   one <li> per "- " line of the entry
// The build stops on a slot with no entry, an entry no slot uses, or a heading used twice, so the file and the page
// can't drift apart. site/vite.config.ts runs it.

/** the entries of COPY.md by heading; notes (HTML comments) and `# Section` lines are for people */
export function parseCopy(md: string): Map<string, string> {
  const text = md.replaceAll(/<!--[\s\S]*?-->/gu, '');
  const entries = new Map<string, string>();
  let key: string | null = null;
  let body: string[] = [];
  const close = (): void => {
    if (key === null) return;
    if (entries.has(key)) throw new Error(`site/COPY.md: "## ${key}" appears twice`);
    entries.set(key, body.join('\n').trim());
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { close(); key = line.slice(3).trim(); body = []; }
    else if (line.startsWith('# ')) { close(); key = null; body = []; }
    else if (key !== null) body.push(line);
  }
  close();
  return entries;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** text without its markdown marks, for attributes and script strings */
export function plain(s: string): string {
  return s.replaceAll(/\*\*(.+?)\*\*/gu, '$1').replaceAll(/`(.+?)`/gu, '$1').replaceAll(/\[(.+?)\]\((.+?)\)/gu, '$1').replaceAll(/\s*\n\s*/gu, ' ');
}

/** one entry as HTML: escaped, then **bold**, `code`, [links](url), ✓ in the accent; a blank line is a line break */
export function inline(s: string): string {
  return s.split(/\n\s*\n/u).map((para) => escapeHtml(para.replaceAll(/\s*\n\s*/gu, ' '))
    .replaceAll(/\*\*(.+?)\*\*/gu, '<b>$1</b>')
    .replaceAll(/`(.+?)`/gu, '<code>$1</code>')
    .replaceAll(/\[(.+?)\]\((.+?)\)/gu, (_m, label: string, url: string) => `<a href="${url}"${url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`)
    .replaceAll('✓', '<span class="ok">✓</span>')).join('<br><br>');
}

/** fill every slot of the page from the entries; returns the page and the names it used */
export function fillCopy(html: string, copy: ReadonlyMap<string, string>): { html: string; used: Set<string> } {
  const used = new Set<string>();
  const missing = new Set<string>();
  const get = (name: string): string => {
    const v = copy.get(name);
    if (v === undefined) { missing.add(name); return ''; }
    used.add(name);
    return v;
  };
  const out = html.replaceAll(/\{\{(list:|@|\$)?([^{}]+?)\}\}/gu, (_m, kind: string | undefined, raw: string) => {
    const name = raw.trim();
    const v = get(name);
    if (kind === '@') return escapeHtml(plain(v));
    if (kind === '$') return JSON.stringify(plain(v)).replaceAll('</', String.raw`<\/`);
    if (kind === 'list:') {
      return v.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => `<li>${inline(l.slice(2))}</li>`).join('');
    }
    return inline(v);
  });
  if (missing.size > 0) throw new Error(`site/COPY.md has no entry for: ${[...missing].map((m) => `"## ${m}"`).join(', ')}`);
  return { html: out, used };
}

/** the entries no slot used: a renamed or misspelled heading */
export function unusedCopy(copy: ReadonlyMap<string, string>, used: ReadonlySet<string>): string[] {
  return [...copy.keys()].filter((k) => !used.has(k));
}
