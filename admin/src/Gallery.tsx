import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './client';
import { shortDate } from './format';
import { categories, Category, GalleryImage, Notify } from './types';
import { ConfirmDialog, Icon, Modal, Segmented, Spinner, stagger } from './ui';

const maxOriginalBytes = 25 * 1024 * 1024;
const maxOptimisedBytes = 8 * 1024 * 1024;
const maxDimension = 2400;
const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Resizes and re-encodes a photo in the browser (WebP, or JPEG where WebP encoding
 * is unsupported) so uploads stay small and EXIF metadata such as GPS is stripped.
 */
async function optimiseImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare photos for upload.');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.86));
  const webp = await encode('image/webp');
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg');
  if (!blob) throw new Error('The photo could not be prepared for upload.');
  return blob;
}
type Filter = 'all' | Category;
const categoryLabel = (id: string) => categories.find(category => category.id === id)?.label || id;

export function Gallery({ images, loading, refresh, notify }: {
  images: GalleryImage[]; loading: boolean; refresh: () => Promise<void>; notify: Notify;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [preview, setPreview] = useState<GalleryImage | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<GalleryImage | null>(null);
  const [removing, setRemoving] = useState(false);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return images
      .filter(image => filter === 'all' || image.category === filter)
      .filter(image => !term || image.alt_text.toLowerCase().includes(term))
      .sort((a, b) => sort === 'newest' ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
  }, [images, filter, query, sort]);

  const remove = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await api(`/api/admin/gallery/${pendingRemoval.id}`, { method: 'DELETE' });
      await refresh();
      notify('Photo removed from the public gallery.');
      setPendingRemoval(null);
      setPreview(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not remove photo.', true);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="view-stack">
      <UploadPanel refresh={refresh} notify={notify} />

      <section className="panel stagger" style={stagger(1)}>
        <div className="panel-heading">
          <div><p className="eyebrow">PUBLISHED</p><h2>{images.length} gallery photos</h2></div>
          <a className="ghost-button" href="/gallery" target="_blank" rel="noopener"><Icon name="external" size={14} />View public gallery</a>
        </div>
        <div className="toolbar">
          <label className="search-field">
            <span className="visually-hidden">Search photos</span>
            <Icon name="search" size={15} />
            <input type="search" placeholder="Search descriptions…" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <Segmented label="Filter by collection" value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'All', count: images.length },
            ...categories.map(category => ({ id: category.id, label: category.label, count: images.filter(image => image.category === category.id).length })),
          ]} />
          <label className="select-field">
            <span className="visually-hidden">Sort photos</span>
            <select value={sort} onChange={event => setSort(event.target.value as 'newest' | 'oldest')}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="photo-grid">{Array.from({ length: 8 }, (_, index) => <div key={index} className="photo-card"><span className="skeleton photo" /></div>)}</div>
        ) : visible.length ? (
          <div className="photo-grid">
            {visible.map((image, index) => (
              <article className="photo-card" key={image.id} style={{ animationDelay: `${Math.min(index, 16) * 30}ms` }}>
                <button type="button" className="photo-open" onClick={() => setPreview(image)} aria-label={`Preview: ${image.alt_text}`}>
                  <FadeImage src={image.image_url} alt={image.alt_text} />
                  <span className="photo-badge">{categoryLabel(image.category)}</span>
                </button>
                <div className="photo-meta">
                  <p>{image.alt_text}</p>
                  <div className="photo-actions">
                    <small>{image.id.startsWith('built-in-') ? 'Original photo' : `Added ${shortDate(image.created_at)}`}</small>
                    <button type="button" className="icon-button danger" onClick={() => setPendingRemoval(image)} aria-label={`Remove ${image.alt_text}`}>
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><Icon name="gallery" size={22} /></span>
            <p>{images.length ? 'No photos match these filters.' : 'No photos yet. Add one above to publish it.'}</p>
          </div>
        )}
      </section>

      {preview && !pendingRemoval && (
        <Modal title={preview.alt_text} onClose={() => setPreview(null)} wide>
          <div className="preview">
            <img src={preview.full_image_url || preview.image_url} alt={preview.alt_text} />
            <div className="preview-meta">
              <div>
                <p className="eyebrow">{categoryLabel(preview.category).toUpperCase()}</p>
                <h2>{preview.alt_text}</h2>
                <p className="muted small">{preview.id.startsWith('built-in-') ? 'Original website photo' : `Uploaded ${shortDate(preview.created_at)}`}</p>
              </div>
              <div className="modal-actions">
                <a className="ghost-button" href="/gallery" target="_blank" rel="noopener"><Icon name="external" size={14} />See on website</a>
                <button type="button" className="danger-button" onClick={() => setPendingRemoval(preview)}><Icon name="trash" size={14} />Remove</button>
                <button type="button" className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview" data-autofocus><Icon name="close" /></button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {pendingRemoval && (
        <ConfirmDialog title="Remove this photo?" confirmLabel="Remove photo" busy={removing}
          body={<>“{pendingRemoval.alt_text}” will no longer appear in the public gallery.{pendingRemoval.id.startsWith('built-in-') && ' The original file stays on the website server.'}</>}
          onConfirm={remove} onCancel={() => setPendingRemoval(null)} />
      )}
    </div>
  );
}

function FadeImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} />;
}

function UploadPanel({ refresh, notify }: { refresh: () => Promise<void>; notify: Notify }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [category, setCategory] = useState<Category>('common');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    if (!acceptedTypes.includes(chosen.type)) {
      notify('Choose a JPG, PNG or WebP image.', true);
      return;
    }
    if (chosen.size > maxOriginalBytes) {
      notify(`That photo is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. The maximum is 25 MB.`, true);
      return;
    }
    setFile(chosen);
    if (!altText) setAltText(chosen.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim());
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files?.[0]);
  };

  const reset = () => {
    setFile(null);
    setAltText('');
    if (input.current) input.current.value = '';
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const optimised = await optimiseImage(file);
      if (optimised.size > maxOptimisedBytes) throw new Error('This photo is still too large after optimising. Try a smaller image.');
      const form = new FormData();
      form.set('image', optimised, optimised.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
      form.set('altText', altText);
      form.set('category', category);
      await api('/api/admin/gallery', { method: 'POST', body: form });
      reset();
      await refresh();
      notify('Photo published to the website gallery.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not upload photo.', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stagger" style={stagger(0)}>
      <div className="panel-heading">
        <div><p className="eyebrow">IMAGE LIBRARY</p><h2>Add a photograph</h2></div>
        <span className="muted small">Resized & optimised in your browser · location data removed</span>
      </div>
      <form className="upload-layout" onSubmit={upload}>
        <div className={`dropzone${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Selected photo preview" />
              <button type="button" className="icon-button floating" onClick={reset} aria-label="Remove selected photo"><Icon name="close" size={15} /></button>
            </>
          ) : (
            <div className="dropzone-copy">
              <span className="empty-icon"><Icon name="upload" size={22} /></span>
              <b>Drop a photo here</b>
              <span>or click to browse · JPG, PNG, WebP · up to 25 MB</span>
            </div>
          )}
          <input ref={input} type="file" accept={acceptedTypes.join(',')} aria-label="Choose photo"
            onChange={event => choose(event.target.files?.[0])} />
        </div>
        <div className="upload-fields">
          <label>Description for visitors
            <input value={altText} onChange={event => setAltText(event.target.value)} minLength={3} maxLength={180}
              placeholder="e.g. Sunrise over the Nilgiri hills from the villa lawn" required />
            <span className="field-hint">{altText.length}/180 · used as the image's accessible description</span>
          </label>
          <div className="field-group">
            <span className="field-label">Collection</span>
            <Segmented label="Collection" value={category} onChange={setCategory} options={categories} />
          </div>
          <button className="primary-button" disabled={busy || !file || altText.trim().length < 3}>
            {busy ? <><Spinner /> Publishing…</> : <><Icon name="upload" size={15} />Publish to gallery</>}
          </button>
        </div>
      </form>
    </section>
  );
}
