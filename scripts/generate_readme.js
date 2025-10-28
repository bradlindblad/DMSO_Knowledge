const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUTS_DIR = path.join(ROOT, 'inputs');
const README = path.join(ROOT, 'README.md');
const START_MARKER = '<!-- DMSO INPUTS INDEX: START -->';
const END_MARKER = '<!-- DMSO INPUTS INDEX: END -->';
const TOPICS = ['cancer', 'lyme', 'migraine'];

function mkFileLink(file, line) {
  const encoded = encodeURIComponent(file).replace(/%2F/g, '/');
  return line ? `./inputs/${encoded}#L${line}` : `./inputs/${encoded}`;
}

function excerptLine(lineText, idx, len = 60) {
  const start = Math.max(0, idx - Math.floor(len / 3));
  const end = Math.min(lineText.length, start + len);
  let s = lineText.slice(start, end).trim();
  if (start > 0) s = '...' + s;
  if (end < lineText.length) s = s + '...';
  return s.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

async function listMdFiles(dir) {
  const names = await fs.readdir(dir);
  return names.filter(n => n.toLowerCase().endsWith('.md')).sort((a, b) => a.localeCompare(b));
}

async function scanFile(file) {
  const full = path.join(INPUTS_DIR, file);
  const raw = await fs.readFile(full, 'utf8');
  const lines = raw.split(/\r?\n/);
  const matches = {};
  const lowLines = lines.map(l => l.toLowerCase());
  for (const topic of TOPICS) {
    matches[topic] = [];
    for (let i = 0; i < lowLines.length; i++) {
      let idx = lowLines[i].indexOf(topic);
      if (idx !== -1) {
        matches[topic].push({
          line: i + 1,
          snippet: excerptLine(lines[i], idx)
        });
        // Continue searching same line for additional occurrences of same topic
        let rest = lowLines[i].slice(idx + topic.length);
        let extraIdx = rest.indexOf(topic);
        while (extraIdx !== -1) {
          // compute absolute index of extra occurrence
          const absoluteIdx = idx + topic.length + extraIdx;
          matches[topic].push({
            line: i + 1,
            snippet: excerptLine(lines[i], absoluteIdx)
          });
          rest = rest.slice(extraIdx + topic.length);
          extraIdx = rest.indexOf(topic);
        }
      }
    }
  }
  // also get title from first heading if present
  const firstLine = lines.find(l => l.trim().length > 0) || file;
  const title = (firstLine.startsWith('#') ? firstLine.replace(/^#+\s*/, '') : file);
  return { file, title, matches };
}

async function buildIndex() {
  const files = await listMdFiles(INPUTS_DIR);
  const entries = [];
  const topicsMap = TOPICS.reduce((acc, t) => { acc[t] = []; return acc; }, {});
  for (const f of files) {
    const scanned = await scanFile(f);
    entries.push(`- [${scanned.title}](${mkFileLink(f)})`);
    for (const topic of TOPICS) {
      const hits = scanned.matches[topic];
      for (const hit of hits) {
        const link = mkFileLink(f, hit.line);
        const lineLabel = `L${hit.line}`;
        topicsMap[topic].push(`- [${scanned.title} ${lineLabel}](${link}) — ${hit.snippet}`);
      }
    }
  }

  const sections = [];
  sections.push('## Index of inputs/\n');
  sections.push('### Topics\n');
  for (const t of TOPICS) sections.push(` - [${t.charAt(0).toUpperCase() + t.slice(1)}](#${t})`);
  sections.push('\n');

  for (const t of TOPICS) {
    sections.push(`### ${t.charAt(0).toUpperCase() + t.slice(1)}\n`);
    if (topicsMap[t].length) {
      sections.push(topicsMap[t].join('\n'));
    } else {
      sections.push('- (no matches found)');
    }
    sections.push('\n');
  }

  sections.push('### All files\n');
  sections.push(entries.join('\n'));
  sections.push('\n');

  return sections.join('\n');
}

async function injectIndex() {
  const readmeRaw = await fs.readFile(README, 'utf8');
  const before = readmeRaw.split(START_MARKER)[0];
  const after = (readmeRaw.split(END_MARKER)[1] || '');
  const index = await buildIndex();
  const newReadme = `${before}${START_MARKER}\n${index}${END_MARKER}${after}`;
  await fs.writeFile(README, newReadme, 'utf8');
  console.log('README.md index updated.');
}

injectIndex().catch(err => {
  console.error(err);
  process.exit(1);
});