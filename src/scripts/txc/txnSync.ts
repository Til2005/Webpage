import { supabase } from '../../lib/supabase';
import type { Note, Folder } from '../txn/stateManager';

const LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

// ── Storage usage ─────────────────────────────────────────────────────────────

export async function getCloudUsage(): Promise<{ usedBytes: number; limitBytes: number } | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const enc = new TextEncoder();

  const [{ data: notesData }, { data: txfeFiles }, { data: txnFiles }] = await Promise.all([
    supabase.from('notes').select('title, content').eq('user_id', userId).eq('is_deleted', false),
    supabase.storage.from('images').list(userId, { limit: 1000 }),
    supabase.storage.from('images').list(`${userId}/txn`, { limit: 1000 }),
  ]);

  const notesBytes = (notesData ?? []).reduce((sum, n) =>
    sum + enc.encode(n.title ?? '').byteLength + enc.encode(n.content ?? '').byteLength, 0);

  const sizeOf = (files: typeof txfeFiles) =>
    (files ?? []).reduce((sum, f) => sum + ((f.metadata as Record<string, number> | null)?.size ?? 0), 0);

  return { usedBytes: notesBytes + sizeOf(txfeFiles) + sizeOf(txnFiles), limitBytes: LIMIT_BYTES };
}

export async function getUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ── Debounced full sync ───────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSyncAll() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncAll(), 2000);
}

export async function syncAll() {
  const userId = await getUserId();
  if (!userId) return;

  const { getState } = await import('../txn/stateManager');
  const { notes, folders } = getState();

  // Check storage limit before uploading
  const [{ data: txfeFiles }, { data: txnFiles }] = await Promise.all([
    supabase.storage.from('images').list(userId, { limit: 1000 }),
    supabase.storage.from('images').list(`${userId}/txn`, { limit: 1000 }),
  ]);
  const sizeOf = (files: typeof txfeFiles) =>
    (files ?? []).reduce((sum, f) => sum + ((f.metadata as Record<string, number> | null)?.size ?? 0), 0);
  const enc = new TextEncoder();
  const notesBytes = notes.reduce((sum, n) =>
    sum + enc.encode(n.title).byteLength + enc.encode(n.content).byteLength, 0);
  const currentUsedBytes = notesBytes + sizeOf(txfeFiles) + sizeOf(txnFiles);
  if (currentUsedBytes > LIMIT_BYTES) {
    throw new Error('Speicherplatz voll (50 MB)');
  }

  if (folders.length > 0) {
    await supabase.from('folders').upsert(
      folders.map(f => ({
        id: f.id,
        user_id: userId,
        name: f.name,
        parent_id: f.parentId,
        created_at: f.createdAt,
        is_deleted: false,
      }))
    );
  }

  if (notes.length > 0) {
    await supabase.from('notes').upsert(
      notes.map(n => ({
        id: n.id,
        user_id: userId,
        title: n.title,
        content: n.content,
        folder_id: n.folderId,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        pinned: n.pinned,
        is_deleted: false,
      }))
    );
  }

  await syncTXNMedia(notes, userId, currentUsedBytes);
}

// ── Individual delete (fire-and-forget) ──────────────────────────────────────

export async function deleteNoteFromCloud(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('notes').update({ is_deleted: true }).eq('id', id).eq('user_id', userId);
}

export async function deleteFolderFromCloud(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('folders').update({ is_deleted: true }).eq('id', id).eq('user_id', userId);
}

// ── Cloud load ────────────────────────────────────────────────────────────────

export async function loadFromCloud(): Promise<{ notes: Note[]; folders: Folder[] } | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const [{ data: notesData }, { data: foldersData }] = await Promise.all([
    supabase.from('notes').select('*').eq('user_id', userId).eq('is_deleted', false),
    supabase.from('folders').select('*').eq('user_id', userId).eq('is_deleted', false),
  ]);

  if (!notesData && !foldersData) return null;

  return {
    notes: (notesData ?? []).map(d => ({
      id: d.id,
      title: d.title,
      content: d.content,
      folderId: d.folder_id,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      pinned: d.pinned ?? false,
    })),
    folders: (foldersData ?? []).map(d => ({
      id: d.id,
      name: d.name,
      parentId: d.parent_id,
      createdAt: d.created_at,
      expanded: false,
    })),
  };
}

// ── Merge local + cloud (newest updatedAt wins for notes) ────────────────────

export function mergeData(
  local: { notes: Note[]; folders: Folder[] },
  cloud: { notes: Note[]; folders: Folder[] }
): { notes: Note[]; folders: Folder[] } {
  const noteMap = new Map<string, Note>();
  for (const n of [...local.notes, ...cloud.notes]) {
    const existing = noteMap.get(n.id);
    if (!existing || n.updatedAt > existing.updatedAt) {
      noteMap.set(n.id, n);
    }
  }

  const folderMap = new Map<string, Folder>();
  for (const f of [...cloud.folders, ...local.folders]) {
    if (!folderMap.has(f.id)) folderMap.set(f.id, f);
  }

  return {
    notes: Array.from(noteMap.values()),
    folders: Array.from(folderMap.values()),
  };
}

// ── TXN: media sync helpers ───────────────────────────────────────────────────

function extractMediaIds(notes: Note[]): Set<string> {
  const ids = new Set<string>();
  const regex = /txn-media:\/\/(txn-media-[^\s"']+)/g;
  for (const note of notes) {
    let m;
    while ((m = regex.exec(note.content)) !== null) ids.add(m[1]);
  }
  return ids;
}

async function syncTXNMedia(notes: Note[], userId: string, currentUsedBytes: number): Promise<void> {
  const { loadMediaBlob } = await import('../txn/mediaStorage');
  const usedIds = extractMediaIds(notes);

  const { data: cloudFiles } = await supabase.storage
    .from('images')
    .list(`${userId}/txn`, { limit: 1000 });
  const cloudIds = new Set((cloudFiles ?? []).map(f => f.name));

  // Collect new blobs and check total size before uploading
  const pending: { id: string; blob: Blob }[] = [];
  for (const id of usedIds) {
    if (cloudIds.has(id)) continue;
    const blob = await loadMediaBlob(id);
    if (!blob) continue;
    pending.push({ id, blob });
  }

  if (pending.length > 0) {
    const newBytes = pending.reduce((s, p) => s + p.blob.size, 0);
    if (currentUsedBytes + newBytes > LIMIT_BYTES) {
      const usedMB = ((currentUsedBytes + newBytes) / (1024 * 1024)).toFixed(1);
      throw new Error(`Speicherplatz reicht nicht aus – ${usedMB} MB von 50 MB benötigt. Entferne große Dateien oder Medien.`);
    }
    for (const { id, blob } of pending) {
      const { error } = await supabase.storage
        .from('images')
        .upload(`${userId}/txn/${id}`, blob, { contentType: blob.type || 'application/octet-stream', upsert: true });
      if (error) throw new Error(`Medien-Upload fehlgeschlagen: ${error.message}`);
    }
  }

  // Delete orphaned media from cloud
  const orphans = (cloudFiles ?? [])
    .filter(f => !usedIds.has(f.name))
    .map(f => `${userId}/txn/${f.name}`);
  if (orphans.length > 0) {
    await supabase.storage.from('images').remove(orphans);
  }
}

export async function loadTXNMediaFromCloud(notes: Note[]): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const { loadMediaBlob, saveMedia } = await import('../txn/mediaStorage');
  const usedIds = extractMediaIds(notes);

  for (const id of usedIds) {
    const existing = await loadMediaBlob(id);
    if (existing) continue;
    const { data, error } = await supabase.storage
      .from('images')
      .download(`${userId}/txn/${id}`);
    if (error || !data) continue;
    await saveMedia(id, data);
  }
}

// ── Cloud contents overview ───────────────────────────────────────────────────

export async function getCloudContents(): Promise<{
  notes: { id: string; title: string; sizeBytes: number }[];
  txfeImages: { name: string; storagePath: string; sizeBytes: number }[];
  txnMedia: { index: number; storagePath: string; sizeBytes: number }[];
} | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const enc = new TextEncoder();

  const [
    { data: notesData },
    { data: txfeImageMeta },
    { data: txfeFiles },
    { data: txnFiles },
  ] = await Promise.all([
    supabase.from('notes').select('id, title, content').eq('user_id', userId).eq('is_deleted', false),
    supabase.from('txfe_images').select('name, storage_path').eq('user_id', userId),
    supabase.storage.from('images').list(userId, { limit: 1000 }),
    supabase.storage.from('images').list(`${userId}/txn`, { limit: 1000 }),
  ]);

  const notes = (notesData ?? []).map(n => ({
    id: n.id as string,
    title: (n.title as string) || 'Unbenannte Notiz',
    sizeBytes: enc.encode(n.title ?? '').byteLength + enc.encode(n.content ?? '').byteLength,
  }));

  const sizeByPath = new Map(
    (txfeFiles ?? [])
      .filter(f => f.metadata)
      .map(f => [`${userId}/${f.name}`, (f.metadata as Record<string, number>)?.size ?? 0])
  );
  const txfeImages = (txfeImageMeta ?? []).map(m => ({
    name: m.name as string,
    storagePath: m.storage_path as string,
    sizeBytes: sizeByPath.get(m.storage_path as string) ?? 0,
  }));

  const txnMedia = (txnFiles ?? [])
    .filter(f => f.metadata)
    .map((f, i) => ({
      index: i + 1,
      storagePath: `${userId}/txn/${f.name}`,
      sizeBytes: (f.metadata as Record<string, number>)?.size ?? 0,
    }));

  return { notes, txfeImages, txnMedia };
}

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('images').createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

// ── TXFE: load image list from cloud ─────────────────────────────────────────

export async function loadImagesFromCloud(): Promise<Array<{ id: string; name: string; url: string; createdAt: string }> | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('txfe_images')
    .select('id, name, storage_path, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return null;

  const results = await Promise.all(
    data.map(async (img) => {
      const { data: urlData } = await supabase.storage
        .from('images')
        .createSignedUrl(img.storage_path, 3600);
      return {
        id: img.id as string,
        name: img.name as string,
        url: urlData?.signedUrl ?? '',
        createdAt: img.created_at as string,
      };
    })
  );

  return results.filter(r => r.url !== '');
}

// ── TXFE: save processed image blob to cloud storage ─────────────────────────

// ── List all cloud media (for TXN media picker) ──────────────────────────────

export async function listCloudMedia(): Promise<{
  txfeImages: { name: string; storagePath: string; mimeType: string; signedUrl: string }[];
  txnMedia: { id: string; storagePath: string; mimeType: string; signedUrl: string }[];
} | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const [
    { data: txfeImageMeta },
    { data: txnFiles },
  ] = await Promise.all([
    supabase.from('txfe_images').select('name, storage_path').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.storage.from('images').list(`${userId}/txn`, { limit: 1000 }),
  ]);

  const txfeImages = await Promise.all(
    (txfeImageMeta ?? []).map(async (img) => {
      const { data } = await supabase.storage.from('images').createSignedUrl(img.storage_path as string, 3600);
      return {
        name: img.name as string,
        storagePath: img.storage_path as string,
        mimeType: 'image/png',
        signedUrl: data?.signedUrl ?? '',
      };
    })
  );

  const txnMedia = await Promise.all(
    (txnFiles ?? []).map(async (f) => {
      const storagePath = `${userId}/txn/${f.name}`;
      const { data } = await supabase.storage.from('images').createSignedUrl(storagePath, 3600);
      const meta = f.metadata as Record<string, string | number> | null;
      return {
        id: f.name,
        storagePath,
        mimeType: (meta?.mimetype as string) ?? 'application/octet-stream',
        signedUrl: data?.signedUrl ?? '',
      };
    })
  );

  return {
    txfeImages: txfeImages.filter(i => i.signedUrl !== ''),
    txnMedia: txnMedia.filter(i => i.signedUrl !== ''),
  };
}

export async function saveImageBlobToCloud(blob: Blob, name: string): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;

  // Check storage limit before uploading
  const usage = await getCloudUsage();
  if (usage && usage.usedBytes + blob.size > usage.limitBytes) {
    throw new Error('Speicherplatz voll (50 MB)');
  }

  const path = `${userId}/${Date.now()}.png`;
  const { error } = await supabase.storage
    .from('images')
    .upload(path, blob, { contentType: 'image/png' });

  if (error) return false;

  await supabase.from('txfe_images').insert({
    id: `img_${Date.now()}`,
    user_id: userId,
    name,
    storage_path: path,
  });

  return true;
}
