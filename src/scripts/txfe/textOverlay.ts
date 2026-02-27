import type { DesignState } from './stateManager';

export function updateTextOverlay(
  element: HTMLElement,
  design: DesignState,
  containerWidth: number,
  containerHeight: number
): void {
  if (!design.text.trim()) {
    element.classList.add('hidden');
    return;
  }

  element.classList.remove('hidden');
  element.textContent = design.text;
  element.style.color = design.color;
  element.style.fontSize = `${design.size}px`;
  element.style.fontWeight = 'bold';

  // Position relative to container
  const left = (design.x / 100) * containerWidth;
  const top = (design.y / 100) * containerHeight;

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.transform = 'translate(-50%, -50%)';
}

export function renderTextToCanvas(
  ctx: CanvasRenderingContext2D,
  design: DesignState,
  imageWidth: number,
  imageHeight: number
): void {
  if (!design.text.trim()) return;

  const scaleFactor = imageWidth / 800; // Base size relative to 800px width
  const fontSize = design.size * scaleFactor;

  ctx.save();
  ctx.font = `bold ${fontSize}px "Google Sans", system-ui, sans-serif`;
  ctx.fillStyle = design.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Add text shadow for readability
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 4 * scaleFactor;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2 * scaleFactor;

  const x = (design.x / 100) * imageWidth;
  const y = (design.y / 100) * imageHeight;

  // Handle multiline text
  const lines = design.text.split('\n');
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = y - totalHeight / 2 + lineHeight / 2;

  lines.forEach((line, index) => {
    ctx.fillText(line, x, startY + index * lineHeight);
  });

  ctx.restore();
}

export function getDesignDefaults(): DesignState {
  return {
    text: '',
    color: '#ffffff',
    size: 32,
    x: 50,
    y: 50,
  };
}
