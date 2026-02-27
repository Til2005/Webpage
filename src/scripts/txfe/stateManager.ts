export interface ImageState {
  id: string;
  file: File;
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  originalDataUrl: string;
  originalNaturalWidth: number;
  originalNaturalHeight: number;
  filters: FilterState;
  crop: CropState;
  design: DesignState;
}

export interface FilterState {
  saturation: number;
  brightness: number;
  contrast: number;
  warmth: number;
  hue: number;
  sharpness: number;
}

export interface CropState {
  aspectRatio: string | null;
  aspectRatioValue: number | null;
  // Crop rectangle in percentages (0-100)
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignState {
  text: string;
  color: string;
  size: number;
  x: number;
  y: number;
}

export interface TXFEState {
  images: ImageState[];
  activeImageId: string | null;
  activeTab: 'filter' | 'crop' | 'design';
}

const defaultFilters: FilterState = {
  saturation: 100,
  brightness: 100,
  contrast: 100,
  warmth: 0,
  hue: 0,
  sharpness: 0,
};

const defaultCrop: CropState = {
  aspectRatio: null,
  aspectRatioValue: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

const defaultDesign: DesignState = {
  text: '',
  color: '#ffffff',
  size: 32,
  x: 50,
  y: 50,
};

type HistoryEntry = { images: ImageState[]; activeImageId: string | null };

class StateManager {
  private state: TXFEState = {
    images: [],
    activeImageId: null,
    activeTab: 'filter',
  };

  private listeners: Set<(state: TXFEState) => void> = new Set();
  private history: HistoryEntry[] = [];
  private readonly MAX_HISTORY = 30;

  private saveToHistory(): void {
    this.history.push({ images: this.state.images, activeImageId: this.state.activeImageId });
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): boolean {
    if (this.history.length === 0) return false;
    const prev = this.history.pop()!;
    this.state = { ...this.state, images: prev.images, activeImageId: prev.activeImageId };
    this.notify();
    return true;
  }

  getState(): TXFEState {
    return this.state;
  }

  getActiveImage(): ImageState | null {
    if (!this.state.activeImageId) return null;
    return this.state.images.find(img => img.id === this.state.activeImageId) || null;
  }

  subscribe(listener: (state: TXFEState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  addImage(file: File, dataUrl: string, naturalWidth: number, naturalHeight: number): string {
    this.saveToHistory();
    const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newImage: ImageState = {
      id,
      file,
      dataUrl,
      naturalWidth,
      naturalHeight,
      originalDataUrl: dataUrl,
      originalNaturalWidth: naturalWidth,
      originalNaturalHeight: naturalHeight,
      filters: { ...defaultFilters },
      crop: { ...defaultCrop },
      design: { ...defaultDesign },
    };

    this.state = {
      ...this.state,
      images: [...this.state.images, newImage],
      activeImageId: this.state.activeImageId || id,
    };

    this.notify();
    return id;
  }

  removeImage(id: string): void {
    const index = this.state.images.findIndex(img => img.id === id);
    if (index === -1) return;

    this.saveToHistory();

    // Memory cleanup: revoke object URL
    const imageToRemove = this.state.images[index];
    if (imageToRemove.dataUrl.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.dataUrl);
    }

    const newImages = this.state.images.filter(img => img.id !== id);
    let newActiveId = this.state.activeImageId;

    if (this.state.activeImageId === id) {
      if (newImages.length > 0) {
        newActiveId = newImages[Math.min(index, newImages.length - 1)].id;
      } else {
        newActiveId = null;
      }
    }

    this.state = {
      ...this.state,
      images: newImages,
      activeImageId: newActiveId,
    };

    this.notify();
  }

  setActiveImage(id: string): void {
    if (this.state.images.some(img => img.id === id)) {
      this.state = { ...this.state, activeImageId: id };
      this.notify();
    }
  }

  setActiveTab(tab: 'filter' | 'crop' | 'design'): void {
    this.state = { ...this.state, activeTab: tab };
    this.notify();
  }

  updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, filters: { ...img.filters, [key]: value } }
          : img
      ),
    };

    this.notify();
  }

  applyFiltersToAll(): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? img
          : { ...img, filters: { ...activeImage.filters } }
      ),
    };

    this.notify();
  }

  updateCrop<K extends keyof CropState>(key: K, value: CropState[K]): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, crop: { ...img.crop, [key]: value } }
          : img
      ),
    };

    this.notify();
  }

  setCrop(crop: Partial<CropState>): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, crop: { ...img.crop, ...crop } }
          : img
      ),
    };

    this.notify();
  }

  resetCrop(): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? {
              ...img,
              dataUrl: img.originalDataUrl,
              naturalWidth: img.originalNaturalWidth,
              naturalHeight: img.originalNaturalHeight,
              crop: { ...defaultCrop },
            }
          : img
      ),
    };

    this.notify();
  }

  applyAndResetCrop(newDataUrl: string, newWidth: number, newHeight: number): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;
    this.saveToHistory();

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, dataUrl: newDataUrl, naturalWidth: newWidth, naturalHeight: newHeight, crop: { ...defaultCrop } }
          : img
      ),
    };

    this.notify();
  }

  updateDesign<K extends keyof DesignState>(key: K, value: DesignState[K]): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, design: { ...img.design, [key]: value } }
          : img
      ),
    };

    this.notify();
  }

  setDesignPosition(x: number, y: number): void {
    const activeImage = this.getActiveImage();
    if (!activeImage) return;

    this.state = {
      ...this.state,
      images: this.state.images.map(img =>
        img.id === activeImage.id
          ? { ...img, design: { ...img.design, x, y } }
          : img
      ),
    };

    this.notify();
  }

  clearAll(): void {
    this.saveToHistory();
    // Memory cleanup: revoke all object URLs
    this.state.images.forEach(img => {
      if (img.dataUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.dataUrl);
      }
    });

    this.state = {
      images: [],
      activeImageId: null,
      activeTab: this.state.activeTab,
    };
    this.notify();
  }

  hasImages(): boolean {
    return this.state.images.length > 0;
  }
}

export const stateManager = new StateManager();
