import type { Note } from './stateManager';

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

export interface SearchResult {
  noteId: string;
  title: string;
  snippet: string;
  matchCount: number;
}

export function searchNotes(notes: Note[], query: string): SearchResult[] {
  if (!query.trim()) return [];

  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  for (const note of notes) {
    const titleLower = note.title.toLowerCase();
    const bodyText = stripHtml(note.content).toLowerCase();
    let matchCount = 0;
    let snippet = '';

    // Title matches
    let idx = titleLower.indexOf(q);
    while (idx !== -1) {
      matchCount++;
      idx = titleLower.indexOf(q, idx + 1);
    }

    // Body matches + extract first-match snippet
    idx = bodyText.indexOf(q);
    if (idx !== -1) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(bodyText.length, idx + query.length + 60);
      snippet =
        (start > 0 ? '…' : '') +
        bodyText.slice(start, end) +
        (end < bodyText.length ? '…' : '');
    }
    while (idx !== -1) {
      matchCount++;
      idx = bodyText.indexOf(q, idx + 1);
    }

    if (matchCount > 0) {
      results.push({ noteId: note.id, title: note.title, snippet, matchCount });
    }
  }

  return results.sort((a, b) => b.matchCount - a.matchCount);
}

export function highlightInEditor(editorEl: HTMLElement, query: string) {
  // Remove existing highlights first
  editorEl.querySelectorAll('mark.txn-highlight').forEach(mark => {
    const parent = mark.parentNode!;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });

  if (!query.trim()) return;

  const q = query.toLowerCase();
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    textNodes.push(node);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(q)) continue;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let matchIdx = lowerText.indexOf(q);

    while (matchIdx !== -1) {
      if (matchIdx > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, matchIdx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'txn-highlight';
      mark.textContent = text.slice(matchIdx, matchIdx + query.length);
      frag.appendChild(mark);
      lastIndex = matchIdx + query.length;
      matchIdx = lowerText.indexOf(q, lastIndex);
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode?.replaceChild(frag, textNode);
  }
}
