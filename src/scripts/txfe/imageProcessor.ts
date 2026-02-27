import type { ImageState } from './stateManager';
import { buildCSSFilter } from './filterEngine';
import { renderTextToCanvas } from './textOverlay';

export async function processImage(imageState: ImageState): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        const { crop } = imageState;

        // Calculate crop dimensions from percentages
        const cropX = (crop.x / 100) * img.naturalWidth;
        const cropY = (crop.y / 100) * img.naturalHeight;
        const cropWidth = (crop.width / 100) * img.naturalWidth;
        const cropHeight = (crop.height / 100) * img.naturalHeight;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        // Apply CSS filters to canvas
        ctx.filter = buildCSSFilter(imageState.filters);

        // Draw cropped image
        ctx.drawImage(
          img,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          cropWidth,
          cropHeight
        );

        // Reset filter for text overlay
        ctx.filter = 'none';

        // Render text overlay
        renderTextToCanvas(ctx, imageState.design, cropWidth, cropHeight);

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob'));
            }
          },
          'image/jpeg',
          0.92
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = imageState.dataUrl;
  });
}

export function generateFileName(originalName: string, index?: number): string {
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  const suffix = index !== undefined ? `_${index + 1}` : '';
  return `${baseName}_txfe${suffix}.jpg`;
}
