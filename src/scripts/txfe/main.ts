import { stateManager, type ImageState, type TXFEState } from './stateManager';
import { buildCSSFilter } from './filterEngine';
import { exportAllImages } from './exportManager';
import { errorHandler, type Notification } from './errorHandler';

// DOM Elements
let fileInput: HTMLInputElement | null;
let previewImage: HTMLImageElement | null;
let emptyState: HTMLElement | null;
let imageContainer: HTMLElement | null;
let textOverlay: HTMLElement | null;
let dropOverlay: HTMLElement | null;
let cropOverlay: HTMLElement | null;
let cropFrame: HTMLElement | null;
let imageHUD: HTMLElement | null;
let clearBtn: HTMLButtonElement | null;
let applyToAllBtn: HTMLButtonElement | null;
let exportBtn: HTMLButtonElement | null;
let txcUploadBtn: HTMLButtonElement | null;
let textPreviewContent: HTMLElement | null;

// Drag state
let isDraggingCrop = false;
let isDraggingText = false;
let isResizingCrop = false;
let resizeHandle: string | null = null;
let dragStartX = 0;
let dragStartY = 0;
let cropStartX = 0;
let cropStartY = 0;
let cropStartWidth = 0;
let cropStartHeight = 0;

export function initTXFE(): void {
  // Get DOM elements
  fileInput = document.getElementById('txfeFileInput') as HTMLInputElement;
  previewImage = document.getElementById('txfePreviewImage') as HTMLImageElement;
  emptyState = document.getElementById('txfeEmptyState');
  imageContainer = document.getElementById('txfeImageContainer');
  textOverlay = document.getElementById('txfeTextOverlay');
  dropOverlay = document.getElementById('txfeDropOverlay');
  cropOverlay = document.getElementById('txfeCropOverlay');
  cropFrame = document.getElementById('txfeCropFrame');
  imageHUD = document.getElementById('txfeImageHUD');
  clearBtn = document.getElementById('txfeClear') as HTMLButtonElement;
  applyToAllBtn = document.getElementById('txfeApplyToAll') as HTMLButtonElement;
  exportBtn = document.getElementById('txfeExport') as HTMLButtonElement;
  txcUploadBtn = document.getElementById('txfeTxcUpload') as HTMLButtonElement;
  textPreviewContent = document.getElementById('txfeTextPreviewContent');

  // Initialize
  setupFileHandling();
  setupSliders();
  setupTabs();
  setupAspectRatios();
  setupColorPicker();
  setupTextInput();
  setupResetCrop();
  setupActions();
  setupCropDragging();
  setupTextDragging();

  // Subscribe to state changes
  stateManager.subscribe(handleStateChange);

  // Ctrl+Z / Cmd+Z — Undo
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    if (stateManager.undo()) {
      errorHandler.info('Rückgängig gemacht');
    }
  });

  // Re-sync crop overlay bounds on window resize
  window.addEventListener('resize', () => {
    const state = stateManager.getState();
    const activeImage = stateManager.getActiveImage();
    if (activeImage && state.activeTab === 'crop') {
      updateCropOverlay(activeImage, true);
    }
  });

  // Check for image passed from TXN
  loadImageFromTXN();
}

function loadImageFromTXN(): void {
  // Signal to opener that TXFE is ready to receive
  if (window.opener) {
    window.opener.postMessage('txfe-ready', '*');
  }
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'txn-image' || !e.data.dataUrl) return;
    const dataUrl = e.data.dataUrl as string;
    const img = new Image();
    img.onload = () => {
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => {
          const file = new File([blob], 'TXN-Bild.png', { type: blob.type || 'image/png' });
          stateManager.addImage(file, dataUrl, img.naturalWidth, img.naturalHeight);
        });
    };
    img.src = dataUrl;
  });
}

function setupNotifications(): void {
  const container = document.getElementById('txfeNotifications');
  if (!container) return;

  errorHandler.subscribe((notification: Notification) => {
    const notificationEl = createNotificationElement(notification);
    container.appendChild(notificationEl);

    // Auto-dismiss
    if (notification.duration) {
      setTimeout(() => {
        removeNotification(notificationEl);
      }, notification.duration);
    }
  });
}

function createNotificationElement(notification: Notification): HTMLElement {
  const el = document.createElement('div');
  el.className = `txfe-notification txfe-notification-${notification.type}`;
  el.setAttribute('data-notification-id', notification.id);

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  el.innerHTML = `
    <div class="txfe-notification-icon">${icons[notification.type]}</div>
    <div class="txfe-notification-message">${notification.message}</div>
    <button class="txfe-notification-close" aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  `;

  const closeBtn = el.querySelector('.txfe-notification-close');
  closeBtn?.addEventListener('click', () => removeNotification(el));

  return el;
}

function removeNotification(el: HTMLElement): void {
  el.classList.add('txfe-notification-exit');
  setTimeout(() => {
    el.remove();
  }, 200);
}

function setupFileHandling(): void {
  const preview = document.querySelector('.txfe-preview');
  // Click to upload
  preview?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.txfe-image-container') && !target.closest('.txfe-empty-state') && emptyState?.classList.contains('hidden')) return;
    if (target.closest('.txfe-crop-frame') || target.closest('.txfe-text-overlay')) return;
    fileInput?.click();
  });

  const hudAdd = document.getElementById('txfeHudAdd');
  hudAdd?.addEventListener('click', () => fileInput?.click());

  // File input change
  fileInput?.addEventListener('change', () => {
    if (fileInput?.files) {
      handleFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Drag and drop
  preview?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropOverlay?.classList.remove('hidden');
  });

  preview?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      dropOverlay?.classList.add('hidden');
    }
  });

  preview?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay?.classList.add('hidden');
    const files = (e as DragEvent).dataTransfer?.files;
    if (files) handleFiles(files);
  });
}

function handleFiles(files: FileList): void {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_IMAGES = 20;
  const DIMENSION_WARNING = 4000;

  const currentCount = stateManager.getState().images.length;
  const remainingSlots = MAX_IMAGES - currentCount;

  if (remainingSlots <= 0) {
    errorHandler.warning(`Maximum ${MAX_IMAGES} Bilder erreicht`);
    return;
  }

  let processedCount = 0;

  Array.from(files).forEach((file, index) => {
    if (index >= remainingSlots) {
      errorHandler.warning(`Nur ${remainingSlots} Bilder hinzugefügt (${MAX_IMAGES} Maximum)`);
      return;
    }

    if (!file.type.startsWith('image/')) {
      errorHandler.warning(`"${file.name}" ist kein Bild`);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      errorHandler.warning(`"${file.name}" ist größer als 10MB`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;

      // Get natural dimensions
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > DIMENSION_WARNING || img.naturalHeight > DIMENSION_WARNING) {
          errorHandler.info(`"${file.name}" ist sehr groß (${img.naturalWidth}×${img.naturalHeight}px)`);
        }
        stateManager.addImage(file, dataUrl, img.naturalWidth, img.naturalHeight);
        processedCount++;
        if (processedCount === 1) {
          errorHandler.success('Bild hinzugefügt');
        } else if (processedCount === files.length || index === remainingSlots - 1) {
          errorHandler.success(`${processedCount} Bilder hinzugefügt`);
        }
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      errorHandler.error(`Fehler beim Laden von "${file.name}"`);
    };
    reader.readAsDataURL(file);
  });
}

function setupSliders(): void {
  const sliderTimeouts = new Map<string, number>();

  document.querySelectorAll('.txfe-slider').forEach((slider) => {
    const input = slider.querySelector('.txfe-slider-input') as HTMLInputElement;
    const fill = slider.querySelector('.txfe-slider-fill') as HTMLElement;
    const thumb = slider.querySelector('.txfe-slider-thumb') as HTMLElement;
    const valueDisplay = slider.querySelector('.txfe-slider-value') as HTMLElement;

    if (!input) return;

    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      const percent = ((value - min) / (max - min)) * 100;
      const unit = input.dataset.unit || '';

      // Update UI immediately
      fill.style.width = `${percent}%`;
      thumb.style.left = `calc(${percent}% - 0.625rem)`;
      valueDisplay.textContent = `${value}${unit}`;

      // Debounce state update
      const sliderId = input.id;
      const existingTimeout = sliderTimeouts.get(sliderId);
      if (existingTimeout) {
        window.clearTimeout(existingTimeout);
      }

      const timeout = window.setTimeout(() => {
        // Update state based on slider ID
        if (sliderId.startsWith('filter-')) {
          const key = sliderId.replace('filter-', '');
          stateManager.updateFilter(key as any, value);
        } else if (sliderId.startsWith('design-')) {
          const keyMap: Record<string, string> = {
            'design-size': 'size',
            'design-x': 'x',
            'design-y': 'y',
          };
          const key = keyMap[sliderId];
          if (key) stateManager.updateDesign(key as any, value);
        }
        sliderTimeouts.delete(sliderId);
      }, 50);

      sliderTimeouts.set(sliderId, timeout);
    });
  });
}

function setupTabs(): void {
  const tabs = document.querySelectorAll('.txfe-tab');
  const panels = document.querySelectorAll('.txfe-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabId = (tab as HTMLElement).dataset.tab as 'filter' | 'crop' | 'design';

      // Update tab styles
      tabs.forEach((t) => {
        t.classList.remove('txfe-tab-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('txfe-tab-active');
      tab.setAttribute('aria-selected', 'true');

      // Show corresponding panel
      panels.forEach((panel) => {
        panel.classList.add('hidden');
      });
      document.getElementById(`txfePanel-${tabId}`)?.classList.remove('hidden');

      stateManager.setActiveTab(tabId);
    });
  });
}

function setupAspectRatios(): void {
  const buttons = document.querySelectorAll('.txfe-aspect-btn');
  const applyBtn = document.getElementById('txfeApplyCrop') as HTMLButtonElement | null;

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.classList.remove('border-[var(--color-fg)]', 'bg-[var(--color-fg)]', 'text-[var(--color-bg)]');
        b.classList.add('border-[var(--color-border)]');
        b.setAttribute('aria-checked', 'false');
      });

      btn.classList.remove('border-[var(--color-border)]');
      btn.classList.add('border-[var(--color-fg)]', 'bg-[var(--color-fg)]', 'text-[var(--color-bg)]');
      btn.setAttribute('aria-checked', 'true');

      const aspectValue = (btn as HTMLElement).dataset.aspectValue || null;
      const aspectRatioNum = (btn as HTMLElement).dataset.aspectRatio;
      const ratio = aspectRatioNum ? parseFloat(aspectRatioNum) : null;

      const activeImage = stateManager.getActiveImage();
      if (activeImage && ratio !== null) {
        // Calculate initial crop for this aspect ratio
        const imgRatio = activeImage.naturalWidth / activeImage.naturalHeight;
        let cropWidth: number, cropHeight: number, cropX: number, cropY: number;

        if (imgRatio > ratio) {
          // Image is wider - crop width
          cropHeight = 100;
          cropWidth = (ratio / imgRatio) * 100;
          cropX = (100 - cropWidth) / 2;
          cropY = 0;
        } else {
          // Image is taller - crop height
          cropWidth = 100;
          cropHeight = (imgRatio / ratio) * 100;
          cropX = 0;
          cropY = (100 - cropHeight) / 2;
        }

        stateManager.setCrop({
          aspectRatio: aspectValue,
          aspectRatioValue: ratio,
          x: cropX,
          y: cropY,
          width: cropWidth,
          height: cropHeight,
        });
        if (applyBtn) applyBtn.disabled = false;
      } else {
        // Reset to full image (Original selected)
        stateManager.setCrop({
          aspectRatio: null,
          aspectRatioValue: null,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        });
        if (applyBtn) applyBtn.disabled = true;
      }
    });
  });
}

function setupColorPicker(): void {
  const buttons = document.querySelectorAll('.txfe-color-btn');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => {
        b.classList.remove('ring-2', 'ring-offset-2', 'ring-[var(--color-fg)]');
        b.setAttribute('aria-checked', 'false');
      });

      btn.classList.add('ring-2', 'ring-offset-2', 'ring-[var(--color-fg)]');
      btn.setAttribute('aria-checked', 'true');

      const color = (btn as HTMLElement).dataset.color || '#ffffff';
      stateManager.updateDesign('color', color);
    });
  });
}

function setupTextInput(): void {
  const textInput = document.getElementById('txfeTextInput') as HTMLTextAreaElement;

  textInput?.addEventListener('input', () => {
    stateManager.updateDesign('text', textInput.value);
  });
}

function setupResetCrop(): void {
  const resetBtn = document.getElementById('txfeResetCrop');
  const applyBtn = document.getElementById('txfeApplyCrop') as HTMLButtonElement | null;

  resetBtn?.addEventListener('click', () => {
    stateManager.resetCrop();
    resetAspectRatioButtons();
    if (applyBtn) applyBtn.disabled = true;
  });

  applyBtn?.addEventListener('click', async () => {
    const activeImage = stateManager.getActiveImage();
    if (!activeImage || activeImage.crop.aspectRatio === null) return;

    applyBtn.disabled = true;
    const originalText = applyBtn.textContent || 'Anwenden';
    applyBtn.textContent = '…';

    try {
      const { crop } = activeImage;
      const img = new Image();
      img.src = activeImage.dataUrl;
      await new Promise<void>((resolve) => { img.onload = () => resolve(); });

      const canvas = document.createElement('canvas');
      const cropX = (crop.x / 100) * img.naturalWidth;
      const cropY = (crop.y / 100) * img.naturalHeight;
      const cropW = (crop.width / 100) * img.naturalWidth;
      const cropH = (crop.height / 100) * img.naturalHeight;
      canvas.width = cropW;
      canvas.height = cropH;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      const newDataUrl = canvas.toDataURL('image/png');
      stateManager.applyAndResetCrop(newDataUrl, cropW, cropH);
      resetAspectRatioButtons();
    } catch {
      applyBtn.disabled = false;
    } finally {
      applyBtn.textContent = originalText;
    }
  });
}

function resetAspectRatioButtons(): void {
  const buttons = document.querySelectorAll('.txfe-aspect-btn');
  buttons.forEach((b, i) => {
    if (i === 0) {
      b.classList.remove('border-[var(--color-border)]');
      b.classList.add('border-[var(--color-fg)]', 'bg-[var(--color-fg)]', 'text-[var(--color-bg)]');
      b.setAttribute('aria-checked', 'true');
    } else {
      b.classList.remove('border-[var(--color-fg)]', 'bg-[var(--color-fg)]', 'text-[var(--color-bg)]');
      b.classList.add('border-[var(--color-border)]');
      b.setAttribute('aria-checked', 'false');
    }
  });
}

function setupActions(): void {
  clearBtn?.addEventListener('click', () => {
    stateManager.clearAll();
  });

  applyToAllBtn?.addEventListener('click', () => {
    stateManager.applyFiltersToAll();
    if (applyToAllBtn) {
      const original = applyToAllBtn.textContent || '';
      applyToAllBtn.textContent = '✓ Angewendet';
      applyToAllBtn.disabled = true;
      setTimeout(() => {
        if (applyToAllBtn) {
          applyToAllBtn.textContent = original;
          applyToAllBtn.disabled = false;
        }
      }, 1500);
    }
  });

  txcUploadBtn?.addEventListener('click', async () => {
    const activeImage = stateManager.getActiveImage();
    if (!activeImage || !txcUploadBtn) return;

    const originalText = txcUploadBtn.textContent || 'In TXC hochladen';
    txcUploadBtn.disabled = true;
    txcUploadBtn.textContent = '…';

    try {
      const { processImage } = await import('./imageProcessor');
      const { saveImageBlobToCloud } = await import('../txc/txnSync');
      const blob = await processImage(activeImage);
      const ok = await saveImageBlobToCloud(blob, activeImage.file.name);
      txcUploadBtn.textContent = ok ? '✓ Hochgeladen' : '✗ Fehler';
      if (ok) errorHandler.success('Bild in TXC gespeichert');
      else errorHandler.error('Upload fehlgeschlagen');
    } catch {
      txcUploadBtn.textContent = '✗ Fehler';
      errorHandler.error('Upload fehlgeschlagen');
    }

    setTimeout(() => {
      if (!txcUploadBtn) return;
      txcUploadBtn.textContent = originalText;
      txcUploadBtn.disabled = stateManager.getState().images.length === 0;
    }, 2500);
  });

  exportBtn?.addEventListener('click', async () => {
    const state = stateManager.getState();
    if (state.images.length === 0) return;

    if (!exportBtn) return;
    exportBtn.disabled = true;
    const originalText = exportBtn.textContent || 'Exportieren';
    exportBtn.textContent = 'Exportiere...';

    try {
      await exportAllImages(state.images);
      if (state.images.length === 1) {
        errorHandler.success('Bild exportiert');
      } else {
        errorHandler.success(`${state.images.length} Bilder als ZIP exportiert`);
      }
    } catch (error) {
      console.error('Export failed:', error);
      errorHandler.error('Export fehlgeschlagen');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = originalText;
    }
  });
}

function setupCropDragging(): void {
  if (!cropFrame) return;

  // Drag crop frame
  cropFrame.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('txfe-crop-handle')) return;
    e.preventDefault();
    isDraggingCrop = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const crop = stateManager.getActiveImage()?.crop;
    if (crop) {
      cropStartX = crop.x;
      cropStartY = crop.y;
    }
  });

  // Resize handles
  cropFrame.querySelectorAll('.txfe-crop-handle').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingCrop = true;
      dragStartX = (e as MouseEvent).clientX;
      dragStartY = (e as MouseEvent).clientY;

      const classes = (handle as HTMLElement).className;
      if (classes.includes('nw')) resizeHandle = 'nw';
      else if (classes.includes('ne')) resizeHandle = 'ne';
      else if (classes.includes('sw')) resizeHandle = 'sw';
      else if (classes.includes('se')) resizeHandle = 'se';

      const crop = stateManager.getActiveImage()?.crop;
      if (crop) {
        cropStartX = crop.x;
        cropStartY = crop.y;
        cropStartWidth = crop.width;
        cropStartHeight = crop.height;
      }
    });
  });

  // Global mouse move/up
  document.addEventListener('mousemove', handleCropMouseMove);
  document.addEventListener('mouseup', () => {
    isDraggingCrop = false;
    isResizingCrop = false;
    resizeHandle = null;
  });

  // Touch support
  cropFrame.addEventListener('touchstart', (e) => {
    if ((e.target as HTMLElement).classList.contains('txfe-crop-handle')) return;
    e.preventDefault();
    isDraggingCrop = true;
    const touch = e.touches[0];
    dragStartX = touch.clientX;
    dragStartY = touch.clientY;
    const crop = stateManager.getActiveImage()?.crop;
    if (crop) {
      cropStartX = crop.x;
      cropStartY = crop.y;
    }
  });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingCrop && !isResizingCrop) return;
    const touch = e.touches[0];
    handleCropMove(touch.clientX, touch.clientY);
  });

  document.addEventListener('touchend', () => {
    isDraggingCrop = false;
    isResizingCrop = false;
    resizeHandle = null;
  });
}

function handleCropMouseMove(e: MouseEvent): void {
  if (!isDraggingCrop && !isResizingCrop) return;
  handleCropMove(e.clientX, e.clientY);
}

function handleCropMove(clientX: number, clientY: number): void {
  const activeImage = stateManager.getActiveImage();
  if (!activeImage || !previewImage) return;

  const imgRect = previewImage.getBoundingClientRect();
  const deltaXPercent = ((clientX - dragStartX) / imgRect.width) * 100;
  const deltaYPercent = ((clientY - dragStartY) / imgRect.height) * 100;

  if (isDraggingCrop) {
    let newX = cropStartX + deltaXPercent;
    let newY = cropStartY + deltaYPercent;

    // Constrain to bounds
    newX = Math.max(0, Math.min(100 - activeImage.crop.width, newX));
    newY = Math.max(0, Math.min(100 - activeImage.crop.height, newY));

    stateManager.setCrop({ x: newX, y: newY });
  } else if (isResizingCrop && resizeHandle) {
    let newX = cropStartX;
    let newY = cropStartY;
    let newWidth = cropStartWidth;
    let newHeight = cropStartHeight;

    const aspectRatio = activeImage.crop.aspectRatioValue;

    if (aspectRatio) {
      // Aspect-ratio-constrained resize: height is the primary axis.
      // Width is derived so that (cropWidth% * natW) / (cropHeight% * natH) = aspectRatio
      // => cropWidth = cropHeight * (aspectRatio / imgRatio)
      const imgRatio = activeImage.naturalWidth / activeImage.naturalHeight;
      const ratio = aspectRatio / imgRatio;

      if (resizeHandle === 'se') {
        newHeight = cropStartHeight + deltaYPercent;
        newWidth = newHeight * ratio;
        // top-left corner stays fixed — no x/y change needed
      } else if (resizeHandle === 'sw') {
        newHeight = cropStartHeight + deltaYPercent;
        newWidth = newHeight * ratio;
        newX = cropStartX + cropStartWidth - newWidth; // keep right edge fixed
      } else if (resizeHandle === 'ne') {
        newHeight = cropStartHeight - deltaYPercent;
        newWidth = newHeight * ratio;
        newY = cropStartY + cropStartHeight - newHeight; // keep bottom edge fixed
      } else if (resizeHandle === 'nw') {
        newHeight = cropStartHeight - deltaYPercent;
        newWidth = newHeight * ratio;
        newX = cropStartX + cropStartWidth - newWidth; // keep right edge fixed
        newY = cropStartY + cropStartHeight - newHeight; // keep bottom edge fixed
      }
    } else {
      if (resizeHandle.includes('e')) newWidth = cropStartWidth + deltaXPercent;
      if (resizeHandle.includes('w')) {
        newX = cropStartX + deltaXPercent;
        newWidth = cropStartWidth - deltaXPercent;
      }
      if (resizeHandle.includes('s')) newHeight = cropStartHeight + deltaYPercent;
      if (resizeHandle.includes('n')) {
        newY = cropStartY + deltaYPercent;
        newHeight = cropStartHeight - deltaYPercent;
      }
    }

    // Constrain
    newWidth = Math.max(10, Math.min(100 - newX, newWidth));
    newHeight = Math.max(10, Math.min(100 - newY, newHeight));
    newX = Math.max(0, Math.min(100 - newWidth, newX));
    newY = Math.max(0, Math.min(100 - newHeight, newY));

    stateManager.setCrop({ x: newX, y: newY, width: newWidth, height: newHeight });
  }
}

function setupTextDragging(): void {
  if (!textOverlay) return;

  let textDragStartX = 0;
  let textDragStartY = 0;
  let textStartX = 0;
  let textStartY = 0;

  const startDrag = (clientX: number, clientY: number) => {
    if (!textOverlay) return;
    isDraggingText = true;
    textDragStartX = clientX;
    textDragStartY = clientY;
    const design = stateManager.getActiveImage()?.design;
    if (design) {
      textStartX = design.x;
      textStartY = design.y;
    }
    textOverlay.classList.add('dragging');
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!isDraggingText || !imageContainer) return;

    const containerRect = imageContainer.getBoundingClientRect();
    const deltaXPercent = ((clientX - textDragStartX) / containerRect.width) * 100;
    const deltaYPercent = ((clientY - textDragStartY) / containerRect.height) * 100;

    let newX = textStartX + deltaXPercent;
    let newY = textStartY + deltaYPercent;

    // Constrain to bounds
    newX = Math.max(0, Math.min(100, newX));
    newY = Math.max(0, Math.min(100, newY));

    stateManager.setDesignPosition(newX, newY);

    // Update sliders
    updateSliderUI('design-x', Math.round(newX));
    updateSliderUI('design-y', Math.round(newY));
  };

  const endDrag = () => {
    if (!textOverlay) return;
    isDraggingText = false;
    textOverlay.classList.remove('dragging');
  };

  // Mouse events
  textOverlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  });

  document.addEventListener('mousemove', (e) => {
    moveDrag(e.clientX, e.clientY);
  });

  document.addEventListener('mouseup', endDrag);

  // Touch events
  textOverlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
  });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingText) return;
    const touch = e.touches[0];
    moveDrag(touch.clientX, touch.clientY);
  });

  document.addEventListener('touchend', endDrag);
}

function updateSliderUI(id: string, value: number): void {
  const input = document.getElementById(id) as HTMLInputElement;
  if (!input) return;

  const slider = input.closest('.txfe-slider');
  if (!slider) return;

  const fill = slider.querySelector('.txfe-slider-fill') as HTMLElement;
  const thumb = slider.querySelector('.txfe-slider-thumb') as HTMLElement;
  const valueDisplay = slider.querySelector('.txfe-slider-value') as HTMLElement;

  input.value = String(value);
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const percent = ((value - min) / (max - min)) * 100;
  const unit = input.dataset.unit || '';

  fill.style.width = `${percent}%`;
  thumb.style.left = `calc(${percent}% - 0.625rem)`;
  valueDisplay.textContent = `${value}${unit}`;
}

function syncFilterSliders(state: TXFEState): void {
  const active = state.images.find(img => img.id === state.activeImageId);
  if (!active) return;
  const f = active.filters;
  updateSliderUI('filter-saturation', f.saturation);
  updateSliderUI('filter-brightness', f.brightness);
  updateSliderUI('filter-contrast', f.contrast);
  updateSliderUI('filter-warmth', f.warmth);
  updateSliderUI('filter-hue', f.hue);
  updateSliderUI('filter-sharpness', f.sharpness);
}

function handleStateChange(state: TXFEState): void {
  updatePreview(state);
  updateImageHUD(state);
  updateActionButtons(state);
  updateTextPreview(state);
  syncFilterSliders(state);
}

function updatePreview(state: TXFEState): void {
  const activeImage = stateManager.getActiveImage();

  if (!activeImage) {
    emptyState?.classList.remove('hidden');
    previewImage?.classList.add('hidden');
    cropOverlay?.classList.add('hidden');
    textOverlay?.classList.add('hidden');
    return;
  }

  emptyState?.classList.add('hidden');

  if (previewImage) {
    previewImage.classList.remove('hidden');
    previewImage.src = activeImage.dataUrl;
    previewImage.style.filter = buildCSSFilter(activeImage.filters);
  }

  // Update crop overlay
  updateCropOverlay(activeImage, state.activeTab === 'crop');

  // Update text overlay
  updateTextOverlayPosition(activeImage);
}

function updateCropOverlay(activeImage: ImageState, showCrop: boolean): void {
  if (!cropOverlay || !cropFrame || !previewImage || !imageContainer) return;

  const { crop } = activeImage;

  // Only show crop overlay when in crop tab and aspect ratio is selected
  if (showCrop && crop.aspectRatio !== null) {
    // Position the overlay to exactly match the displayed image bounds,
    // not the full container — the image may be smaller due to max-width/height.
    const imgRect = previewImage.getBoundingClientRect();
    const containerRect = imageContainer.getBoundingClientRect();
    const left = imgRect.left - containerRect.left;
    const top = imgRect.top - containerRect.top;
    cropOverlay.style.inset = 'auto';
    cropOverlay.style.left = `${left}px`;
    cropOverlay.style.top = `${top}px`;
    cropOverlay.style.width = `${imgRect.width}px`;
    cropOverlay.style.height = `${imgRect.height}px`;
    cropOverlay.classList.remove('hidden');

    // Position crop frame as percentages relative to the overlay (= image)
    cropFrame.style.left = `${crop.x}%`;
    cropFrame.style.top = `${crop.y}%`;
    cropFrame.style.width = `${crop.width}%`;
    cropFrame.style.height = `${crop.height}%`;
  } else {
    cropOverlay.classList.add('hidden');
    cropOverlay.style.inset = '';
    cropOverlay.style.left = '';
    cropOverlay.style.top = '';
    cropOverlay.style.width = '';
    cropOverlay.style.height = '';
  }
}

function updateTextOverlayPosition(activeImage: ImageState): void {
  if (!textOverlay || !imageContainer) return;

  const { design } = activeImage;

  if (!design.text.trim()) {
    textOverlay.classList.add('hidden');
    return;
  }

  textOverlay.classList.remove('hidden');
  textOverlay.textContent = design.text;
  textOverlay.style.color = design.color;
  textOverlay.style.fontSize = `${design.size}px`;
  textOverlay.style.fontWeight = 'bold';
  textOverlay.style.left = `${design.x}%`;
  textOverlay.style.top = `${design.y}%`;
  textOverlay.style.transform = 'translate(-50%, -50%)';
}

function updateTextPreview(state: TXFEState): void {
  if (!textPreviewContent) return;

  const activeImage = stateManager.getActiveImage();
  if (!activeImage || !activeImage.design.text.trim()) {
    textPreviewContent.innerHTML = '<span class="text-[var(--color-muted)] text-sm">Text erscheint hier...</span>';
    return;
  }

  const { design } = activeImage;
  textPreviewContent.innerHTML = `<span style="color: ${design.color}; font-size: ${Math.min(design.size, 40)}px; font-weight: bold; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">${design.text.replace(/\n/g, '<br>')}</span>`;
}

function updateImageHUD(state: TXFEState): void {
  if (!imageHUD) return;

  const hudContainer = document.querySelector('.txfe-image-hud') as HTMLElement;

  // Hide entire HUD if no images
  if (state.images.length === 0) {
    if (hudContainer) hudContainer.style.display = 'none';
    return;
  }

  // Show HUD when images are present
  if (hudContainer) hudContainer.style.display = 'flex';

  const renderItem = (img: ImageState, index: number, isActive: boolean): string => `
    <div class="txfe-hud-item ${isActive ? 'active' : ''}" data-image-id="${img.id}">
      <img src="${img.dataUrl}" alt="Bild ${index + 1}" style="filter: ${buildCSSFilter(img.filters)}" />
      <div class="txfe-hud-item-number">${index + 1}</div>
      <button class="txfe-hud-item-remove" aria-label="Bild ${index + 1} entfernen">
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `;

  const html = state.images.map((img, index) =>
    renderItem(img, index, img.id === state.activeImageId)
  ).join('');

  imageHUD.innerHTML = html;

  // Add click handlers
  document.querySelectorAll('.txfe-hud-item').forEach((item) => {
    const imageId = (item as HTMLElement).dataset.imageId;
    if (!imageId) return;

    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.txfe-hud-item-remove')) {
        e.stopPropagation();
        stateManager.removeImage(imageId);
      } else {
        stateManager.setActiveImage(imageId);
      }
    });
  });

  // Show add buttons when images are present

}

function hasFiltersChanged(state: TXFEState): boolean {
  const active = stateManager.getActiveImage();
  if (!active) return false;
  const f = active.filters;
  return f.saturation !== 100 || f.brightness !== 100 || f.contrast !== 100
    || f.warmth !== 0 || f.hue !== 0 || f.sharpness !== 0;
}

function updateActionButtons(state: TXFEState): void {
  const hasImages = state.images.length > 0;
  const showApplyToAll = state.images.length > 1 && hasFiltersChanged(state);

  if (clearBtn) clearBtn.disabled = !hasImages;
  if (exportBtn) exportBtn.disabled = !hasImages;
  if (txcUploadBtn) txcUploadBtn.disabled = !hasImages;

  if (applyToAllBtn) {
    applyToAllBtn.disabled = !showApplyToAll;
    applyToAllBtn.style.display = showApplyToAll ? '' : 'none';
  }
}
