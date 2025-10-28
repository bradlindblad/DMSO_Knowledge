const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const INPUTS_DIR = path.join(ROOT, 'inputs');
const README = path.join(ROOT, 'README.md');
const START_MARKER = '<!-- DMSO INPUTS INDEX: START -->';
const END_MARKER = '<!-- DMSO INPUTS INDEX: END -->';
const TOPICS = ['cancer', 'lyme', 'migraine'];

function detectGitBlobBase(root) {
  try {
    const remote = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim();
    let httpsBase;
    if (remote.startsWith('git@')) {
      const m = remote.match(/^git@(.*?):(.*?)(?:\.git)?$/);
      if (!m) throw new Error('unexpected remote format');
      httpsBase = `https://${m[1]}/${m[2].replace(/\.git$/, '')}`;
    } else {
      httpsBase = remote.replace(/\.git$/, '');
    }
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
    return `${httpsBase.replace(/\/$/, '')}/blob/${branch}`;
  } catch (e) {
    return process.env.GITHUB_BLOB_BASE || '';
  }
}

const GITHUB_BLOB_BASE = detectGitBlobBase(ROOT);

function generateGitHubAnchor(headingText) {
  // GitHub's anchor generation rules:
  // 1. Convert to lowercase
  // 2. Remove punctuation (keep alphanumeric, spaces, hyphens, underscores)
  // 3. Replace spaces with hyphens
  // 4. Remove leading/trailing hyphens
  return headingText
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove punctuation except word chars, spaces, hyphens
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

function mkFileLink(file, anchor) {
  const filePath = `inputs/${file}`;
  const encoded = encodeURIComponent(filePath).replace(/%2F/g, '/');
  if (GITHUB_BLOB_BASE) {
    return anchor ? `${GITHUB_BLOB_BASE}/${encoded}#${anchor}` : `${GITHUB_BLOB_BASE}/${encoded}`;
  }
  return anchor ? `./inputs/${encodeURIComponent(file)}#${anchor}` : `./inputs/${encodeURIComponent(file)}`;
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
  
  // Track headings for anchor generation
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const headingMatch = lines[i].match(/^(#+)\s+(.+)$/);
    if (headingMatch) {
      const headingText = headingMatch[2].trim();
      const anchor = generateGitHubAnchor(headingText);
      headings.push({ 
        line: i + 1, 
        anchor,
        text: headingText
      });
    }
  }
  
  // Find matches for each topic
  for (const topic of TOPICS) {
    matches[topic] = [];
    const seenLines = new Set(); // Deduplicate multiple matches on same line
    
    for (let i = 0; i < lowLines.length; i++) {
      const lineNum = i + 1;
      if (lowLines[i].includes(topic) && !seenLines.has(lineNum)) {
        seenLines.add(lineNum);
        const idx = lowLines[i].indexOf(topic);
        
        // Find nearest heading before this line
        let nearestHeading = null;
        for (let j = headings.length - 1; j >= 0; j--) {
          if (headings[j].line <= lineNum) {
            nearestHeading = headings[j];
            break;
          }
        }
        
        matches[topic].push({
          line: lineNum,
          snippet: excerptLine(lines[i], idx),
          anchor: nearestHeading?.anchor,
          section: nearestHeading?.text || 'Top of file'
        });
      }
    }
  }
  
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
        const link = mkFileLink(f, hit.anchor);
        const location = hit.anchor ? `→ ${hit.section}` : '(top)';
        topicsMap[topic].push(`- [${scanned.title}](${link}) ${location} — ${hit.snippet}`);
      }
    }
  }

  const sections = [];
  sections.push('## Index of inputs/\n');
  sections.push('### Topics\n');
  for (const t of TOPICS) {
    sections.push(`- [${t.charAt(0).toUpperCase() + t.slice(1)}](#${t})`);
  }
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
  
  if (!readmeRaw.includes(START_MARKER) || !readmeRaw.includes(END_MARKER)) {
    throw new Error(`README.md must contain both ${START_MARKER} and ${END_MARKER}`);
  }
  
  const before = readmeRaw.split(START_MARKER)[0];
  const after = readmeRaw.split(END_MARKER)[1];
  const index = await buildIndex();
  const newReadme = `${before}${START_MARKER}\n${index}${END_MARKER}${after}`;
  await fs.writeFile(README, newReadme, 'utf8');
  console.log('README.md index updated.');
}

injectIndex().catch(err => {
  console.error(err);
  process.exit(1);
});