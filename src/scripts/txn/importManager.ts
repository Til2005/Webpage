import JSZip from 'jszip';
import type { Note } from './stateManager';

export type ImportedNote = Pick<Note, 'title' | 'content'>;

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Plain Text ────────────────────────────────────────────────────────────────

function parseTxt(text: string, filename: string): ImportedNote {
  const title = filename.replace(/\.txt$/i, '').trim() || 'Importierte Notiz';
  const lines = text.split('\n');
  const html = lines
    .map(line => line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
  return { title, content: html };
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────

function parseMd(text: string, filename: string): ImportedNote {
  let raw = text;

  // Extract title from first H1 if present
  const h1Match = raw.match(/^#\s+(.+)/m);
  const title = h1Match
    ? h1Match[1].trim()
    : filename.replace(/\.mdx?$/i, '').trim() || 'Importierte Notiz';

  // Strip front matter
  raw = raw.replace(/^---[\s\S]*?---\s*\n/, '');

  // Code blocks (protect them)
  const codeBlocks: string[] = [];
  raw = raw.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // Headings
  raw = raw.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  raw = raw.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  raw = raw.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  raw = raw.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  raw = raw.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  raw = raw.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  raw = raw.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  raw = raw.replace(/^[-*_]{3,}$/gm, '<hr>');

  // Lists
  raw = raw.replace(/(^[-*+]\s+.+(\n[-*+]\s+.+)*)/gm, (block) => {
    const items = block.split('\n')
      .filter(l => l.trim())
      .map(l => `<li>${escapeHtml(l.replace(/^[-*+]\s+/, ''))}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });
  raw = raw.replace(/(^\d+\.\s+.+(\n\d+\.\s+.+)*)/gm, (block) => {
    const items = block.split('\n')
      .filter(l => l.trim())
      .map(l => `<li>${escapeHtml(l.replace(/^\d+\.\s+/, ''))}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Inline styles
  raw = raw.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  raw = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  raw = raw.replace(/__(.+?)__/g, '<strong>$1</strong>');
  raw = raw.replace(/\*(.+?)\*/g, '<em>$1</em>');
  raw = raw.replace(/_(.+?)_/g, '<em>$1</em>');
  raw = raw.replace(/~~(.+?)~~/g, '<del>$1</del>');
  raw = raw.replace(/==(.+?)==/g, '<mark>$1</mark>');
  raw = raw.replace(/`(.+?)`/g, '<code>$1</code>');
  raw = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  raw = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Paragraphs
  const lines = raw.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { out.push('<p><br></p>'); continue; }
    if (t.startsWith('<') || t.startsWith('\x00CODE')) { out.push(t); continue; }
    out.push(`<p>${t}</p>`);
  }

  // Restore code blocks
  let html = out.join('');
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[parseInt(i)]);

  return { title, content: html };
}

// ── DOCX → HTML (via JSZip + XML parsing) ────────────────────────────────────

async function parseDocx(file: File, filename: string): Promise<ImportedNote> {
  const title = filename.replace(/\.docx?$/i, '').trim() || 'Importierte Notiz';
  try {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const xmlStr = await zip.file('word/document.xml')?.async('string');
    if (!xmlStr) return { title, content: '<p>Dokument konnte nicht gelesen werden.</p>' };

    const content = docxXmlToHtml(xmlStr);
    return { title, content };
  } catch (err) {
    return { title, content: `<p>Fehler beim Importieren: ${String(err)}</p>` };
  }
}

function docxXmlToHtml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = Array.from(doc.getElementsByTagNameNS(W, 'p'));
  const parts: string[] = [];

  for (const para of paragraphs) {
    const pStyleEl = para.getElementsByTagNameNS(W, 'pStyle')[0];
    const pStyle = pStyleEl?.getAttribute('w:val') || '';
    const runs = Array.from(para.getElementsByTagNameNS(W, 'r'));
    let paraHtml = '';

    for (const run of runs) {
      const rPr = run.getElementsByTagNameNS(W, 'rPr')[0];
      let text = Array.from(run.getElementsByTagNameNS(W, 't'))
        .map(t => t.textContent || '').join('');
      const hasBr = run.getElementsByTagNameNS(W, 'br').length > 0;

      if (rPr) {
        const isBold = rPr.getElementsByTagNameNS(W, 'b').length > 0;
        const isItalic = rPr.getElementsByTagNameNS(W, 'i').length > 0;
        const isUnderline = rPr.getElementsByTagNameNS(W, 'u').length > 0;
        const isStrike = rPr.getElementsByTagNameNS(W, 'strike').length > 0;
        const colorEl = rPr.getElementsByTagNameNS(W, 'color')[0];
        if (isStrike) text = `<del>${escapeHtml(text)}</del>`;
        else if (isUnderline) text = `<u>${escapeHtml(text)}</u>`;
        else text = escapeHtml(text);
        if (isItalic) text = `<em>${text}</em>`;
        if (isBold) text = `<strong>${text}</strong>`;
        if (colorEl) {
          const c = colorEl.getAttribute('w:val');
          if (c && c !== 'auto') text = `<span style="color:#${c}">${text}</span>`;
        }
      } else {
        text = escapeHtml(text);
      }
      paraHtml += text;
      if (hasBr) paraHtml += '<br>';
    }

    if (!paraHtml.trim()) {
      parts.push('<p><br></p>');
    } else if (/^[Hh]eading(\d)/.test(pStyle)) {
      const lvl = pStyle.replace(/[^0-9]/g, '') || '1';
      parts.push(`<h${lvl}>${paraHtml}</h${lvl}>`);
    } else {
      parts.push(`<p>${paraHtml}</p>`);
    }
  }

  return parts.join('') || '<p></p>';
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function importFile(file: File): Promise<ImportedNote | null> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'txt': return parseTxt(await file.text(), file.name);
    case 'md': case 'markdown': return parseMd(await file.text(), file.name);
    case 'docx': case 'doc': return parseDocx(file, file.name);
    default: return null;
  }
}
