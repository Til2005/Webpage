import type { ImageState } from './stateManager';
import { processImage, generateFileName } from './imageProcessor';
import JSZip from 'jszip';

export async function exportSingleImage(imageState: ImageState): Promise<void> {
  const blob = await processImage(imageState);
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = generateFileName(imageState.file.name);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export async function exportAllImages(
  images: ImageState[],
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  if (images.length === 0) return;

  if (images.length === 1) {
    await exportSingleImage(images[0]);
    return;
  }

  // Multiple images - create ZIP
  const zip = new JSZip();

  for (let i = 0; i < images.length; i++) {
    const imageState = images[i];
    onProgress?.(i + 1, images.length);

    const blob = await processImage(imageState);
    const fileName = generateFileName(imageState.file.name, i);
    zip.file(fileName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `txfe_export_${Date.now()}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
