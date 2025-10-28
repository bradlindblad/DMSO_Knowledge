// ...existing code...
const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUTS_DIR = path.join(ROOT, 'inputs');
const README = path.join(ROOT, 'README.md');

function mkLink(file) {
  // encode spaces and special chars but keep slashes
  return `./inputs/${encodeURIComponent(file).replace(/%2F/g, '/')}`;
}

async function listMdFiles(dir) {
  const names = await fs.readdir(dir);
  return names.filter(n => n.toLowerCase().endsWith('.md')).sort((a, b) => a.localeCompare(b));
}

async function buildReadme() {
  const files = await listMdFiles(INPUTS_DIR);
  const lines = [];
  lines.push('# Index of inputs');
  lines.push('');
  if (files.length === 0) {
    lines.push('_No markdown files found in inputs/_');
  } else {
    for (const f of files) {
      // use the filename (without path) as the link text
      const nameOnly = path.parse(f).base; // retains extension; use .name to drop extension
      lines.push(`- [${nameOnly}](${mkLink(f)})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const readme = await buildReadme();
  await fs.writeFile(README, readme, 'utf8');
  console.log('README.md written with list of inputs/*.md files (filename used as link text).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
// ...existing code...