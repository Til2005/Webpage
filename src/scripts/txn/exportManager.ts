import JSZip from 'jszip';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { Note } from './stateManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function safeFilename(title: string) {
  return title.replace(/[^a-z0-9äöüÄÖÜß\-_\s]/gi, '').trim() || 'notiz';
}

function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('de-DE', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Plain Text ────────────────────────────────────────────────────────────────

function noteToTxt(note: Note): string {
  return htmlToText(note.content);
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function nodeToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  if (!tag) return Array.from(el.childNodes).map(nodeToMd).join('');

  const children = () => Array.from(el.childNodes).map(nodeToMd).join('');

  switch (tag) {
    case 'div': case 'p': return `\n\n${children()}\n\n`;
    case 'br': return '\n';
    case 'h1': return `\n\n# ${children()}\n\n`;
    case 'h2': return `\n\n## ${children()}\n\n`;
    case 'h3': return `\n\n### ${children()}\n\n`;
    case 'h4': return `\n\n#### ${children()}\n\n`;
    case 'h5': return `\n\n##### ${children()}\n\n`;
    case 'h6': return `\n\n###### ${children()}\n\n`;
    case 'b': case 'strong': return `**${children()}**`;
    case 'i': case 'em': return `*${children()}*`;
    case 'u': return `<u>${children()}</u>`;
    case 's': case 'del': case 'strike': return `~~${children()}~~`;
    case 'mark': return `==${children()}==`;
    case 'code': return `\`${children()}\``;
    case 'pre': return `\n\n\`\`\`\n${children()}\n\`\`\`\n\n`;
    case 'blockquote': return `\n\n> ${children().trim()}\n\n`;
    case 'ul': {
      const items = Array.from(el.children)
        .map(li => `- ${nodeToMd(li).trim()}`).join('\n');
      return `\n\n${items}\n\n`;
    }
    case 'ol': {
      const items = Array.from(el.children)
        .map((li, i) => `${i + 1}. ${nodeToMd(li).trim()}`).join('\n');
      return `\n\n${items}\n\n`;
    }
    case 'li': return children();
    case 'a': return `[${children()}](${el.getAttribute('href') || ''})`;
    case 'img': return `![${el.getAttribute('alt') || ''}](${el.getAttribute('src') || ''})`;
    case 'video': return `<!-- Video: ${el.getAttribute('src') || ''} -->`;
    default: return children();
  }
}

function noteToMd(note: Note): string {
  const div = document.createElement('div');
  div.innerHTML = note.content;
  return nodeToMd(div).replace(/\n{3,}/g, '\n\n').trim();
}

// ── DOCX (minimal OOXML via JSZip) ───────────────────────────────────────────

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  sizePt?: number;
}

interface DocxParagraph {
  runs: Array<{ text: string; props: RunProps }>;
  style?: string;
  listType?: 'bullet' | 'ordered';
}

function colorToHex(color: string): string {
  if (!color) return '';
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) {
    return [m[1], m[2], m[3]]
      .map(v => parseInt(v).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }
  return color.replace('#', '').toUpperCase();
}

function extractRuns(el: Node, props: RunProps): Array<{ text: string; props: RunProps }> {
  const runs: Array<{ text: string; props: RunProps }> = [];

  function traverse(n: Node, p: RunProps) {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.textContent) runs.push({ text: n.textContent, props: { ...p } });
      return;
    }
    const e = n as HTMLElement;
    const tag = e.tagName?.toLowerCase();
    const np = { ...p };
    switch (tag) {
      case 'b': case 'strong': np.bold = true; break;
      case 'i': case 'em': np.italic = true; break;
      case 'u': np.underline = true; break;
      case 's': case 'del': np.strike = true; break;
      case 'br': runs.push({ text: '\n', props: { ...np } }); return;
      case 'span': {
        const st = (e as HTMLElement).style;
        if (st.color) np.color = colorToHex(st.color);
        if (st.fontSize) np.sizePt = Math.round(parseFloat(st.fontSize) * 0.75);
        break;
      }
    }
    Array.from(e.childNodes).forEach(c => traverse(c, np));
  }
  traverse(el, props);
  return runs;
}

function htmlToDocxParagraphs(html: string): DocxParagraph[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const paras: DocxParagraph[] = [];

  function processBlock(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      if ((n.textContent || '').trim()) {
        paras.push({ runs: [{ text: n.textContent!, props: {} }] });
      }
      return;
    }
    const e = n as HTMLElement;
    const tag = e.tagName?.toLowerCase();
    switch (tag) {
      case 'p': case 'div':
        paras.push({ runs: extractRuns(e, {}) });
        break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        paras.push({ runs: extractRuns(e, { bold: true }), style: `Heading${tag[1]}` });
        break;
      case 'ul':
        Array.from(e.children).forEach(li =>
          paras.push({ runs: extractRuns(li, {}), listType: 'bullet' })
        );
        break;
      case 'ol':
        Array.from(e.children).forEach(li =>
          paras.push({ runs: extractRuns(li, {}), listType: 'ordered' })
        );
        break;
      case 'blockquote':
        paras.push({ runs: extractRuns(e, { italic: true }), style: 'Quote' });
        break;
      case 'br':
        paras.push({ runs: [{ text: '', props: {} }] });
        break;
      default:
        if (tag) {
          const r = extractRuns(e, {});
          if (r.length) paras.push({ runs: r });
        }
    }
  }

  Array.from(div.childNodes).forEach(processBlock);
  return paras;
}

function buildDocumentXml(paras: DocxParagraph[]): string {
  const paraXml = paras.map(para => {
    const pStyle = para.style ? `<w:pStyle w:val="${para.style}"/>` : '';
    const numPr = para.listType === 'bullet'
      ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`
      : para.listType === 'ordered'
      ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`
      : '';
    const pPr = (pStyle || numPr) ? `<w:pPr>${pStyle}${numPr}</w:pPr>` : '';

    const runs = para.runs.map(run => {
      const rpr: string[] = [];
      if (run.props.bold) rpr.push('<w:b/>');
      if (run.props.italic) rpr.push('<w:i/>');
      if (run.props.underline) rpr.push('<w:u w:val="single"/>');
      if (run.props.strike) rpr.push('<w:strike/>');
      if (run.props.color) rpr.push(`<w:color w:val="${run.props.color}"/>`);
      if (run.props.sizePt) rpr.push(`<w:sz w:val="${run.props.sizePt * 2}"/>`);
      const rprXml = rpr.length ? `<w:rPr>${rpr.join('')}</w:rPr>` : '';
      const parts = run.text.split('\n');
      const rContent = parts.map((p, i) =>
        `<w:t xml:space="preserve">${escapeXml(p)}</w:t>${i < parts.length - 1 ? '<w:br/>' : ''}`
      ).join('');
      return `<w:r>${rprXml}${rContent}</w:r>`;
    }).join('');

    return `<w:p>${pPr}${runs}</w:p>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${paraXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

async function generateDocxBlob(note: Note): Promise<Blob> {
  const zip = new JSZip();
  const paras = htmlToDocxParagraphs(note.content);

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`);

  zip.file('word/document.xml', buildDocumentXml(paras));

  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
</w:styles>`);

  zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ── PDF ───────────────────────────────────────────────────────────────────────

async function exportPDF(note: Note) {
  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed', 'left:-9999px', 'top:0',
    'width:794px', 'padding:60px 80px',
    'font-family:"Google Sans",system-ui,sans-serif',
    'font-size:12pt', 'line-height:1.7',
    'color:#000', 'background:#fff',
    'box-sizing:border-box',
  ].join(';');

  container.innerHTML = `<div style="font-size:12pt;">${note.content}</div>`;

  container.querySelectorAll<HTMLElement>('mark.txn-highlight').forEach(el => {
    el.style.background = 'transparent';
  });

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height / canvas.width) * pdfW;

    let remaining = imgH;
    let yOffset = 0;

    pdf.addImage(imgData, 'JPEG', 0, yOffset, pdfW, imgH);
    remaining -= pdfH;

    while (remaining > 0) {
      yOffset -= pdfH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, yOffset, pdfW, imgH);
      remaining -= pdfH;
    }

    pdf.save(`${safeFilename(note.title)}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ExportFormat = 'pdf' | 'md' | 'txt' | 'docx';

export async function exportNote(note: Note, format: ExportFormat) {
  const name = safeFilename(note.title);
  switch (format) {
    case 'pdf':
      await exportPDF(note);
      break;
    case 'txt':
      downloadBlob(new Blob([noteToTxt(note)], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
      break;
    case 'md':
      downloadBlob(new Blob([noteToMd(note)], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
      break;
    case 'docx': {
      const blob = await generateDocxBlob(note);
      downloadBlob(blob, `${name}.docx`);
      break;
    }
  }
}

export async function exportMultiple(notes: Note[], format: ExportFormat) {
  if (notes.length === 0) return;
  if (notes.length === 1) { await exportNote(notes[0], format); return; }

  if (format === 'pdf') {
    for (const note of notes) await exportPDF(note);
    return;
  }

  const zip = new JSZip();
  for (const note of notes) {
    const name = safeFilename(note.title);
    switch (format) {
      case 'txt': zip.file(`${name}.txt`, noteToTxt(note)); break;
      case 'md': zip.file(`${name}.md`, noteToMd(note)); break;
      case 'docx': zip.file(`${name}.docx`, await generateDocxBlob(note)); break;
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `txn_export_${Date.now()}.zip`);
}
