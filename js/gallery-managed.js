const galleryMeta = document.querySelector('meta[name="mandarin-api-url"]');
const configuredApiUrl = galleryMeta?.content.trim().replace(/\/$/, '');
const galleryApiUrl = configuredApiUrl || (location.protocol.startsWith('http') ? '' : null);
const galleryGrid = document.querySelector('.gallery-full-grid');

const categoryFor = image => {
  const text = `${image.alt} ${image.src}`.toLowerCase();
  if (/bed|bath|double room|suite|villa room/.test(text)) return 'rooms';
  if (/hill|mist|view|kodanadu|waterfall|sunrise|forest/.test(text)) return 'landscapes';
  if (/garden|exterior|cottage|villa/.test(text)) return 'exteriors';
  return 'common';
};

const bindGalleryFilters = () => {
  galleryGrid?.querySelectorAll('.gallery-full-item').forEach(item => {
    if (!item.dataset.category) item.dataset.category = categoryFor(item.querySelector('img') || { alt: '', src: '' });
  });
  document.querySelectorAll('.gallery-cat-btn').forEach(button => {
    if (button.dataset.filterBound) return;
    button.dataset.filterBound = 'true';
    button.addEventListener('click', () => {
      document.querySelector('.gallery-cat-btn.active')?.classList.remove('active');
      button.classList.add('active');
      const category = button.textContent.trim().toLowerCase().replace('common areas', 'common');
      galleryGrid?.querySelectorAll('.gallery-full-item').forEach(item => {
        item.hidden = category !== 'all' && item.dataset.category !== category;
      });
    });
  });
};

bindGalleryFilters();

if (galleryApiUrl !== null && galleryGrid) {
  fetch(`${galleryApiUrl}/api/gallery`)
    .then(response => {
      if (!response.ok) throw new Error(`Gallery request failed (${response.status})`);
      return response.json();
    })
    .then(images => {
      if (!Array.isArray(images)) throw new Error('Gallery API returned an invalid response.');
      galleryGrid.replaceChildren(...images.map(image => {
        const item = document.createElement('div');
        item.className = 'gallery-full-item';
        item.dataset.lightbox = '';
        item.dataset.category = image.category;

        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        const img = document.createElement('img');
        img.src = image.image_url;
        img.alt = image.alt_text;
        img.dataset.fullSrc = image.full_image_url || image.image_url;
        if (image.srcset) img.srcset = image.srcset;
        if (image.sizes) img.sizes = image.sizes;
        img.loading = 'lazy';
        img.decoding = 'async';
        wrap.append(img);
        item.append(wrap);

        const overlay = document.createElement('div');
        overlay.className = 'gallery-full-item-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<svg class="gallery-icon" width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="18" r="16"/><line x1="18" y1="11" x2="18" y2="25"/><line x1="11" y1="18" x2="25" y2="18"/></svg>';
        item.append(overlay);
        return item;
      }));
      bindGalleryFilters();
    })
    .catch(error => console.error('Could not refresh the managed photo gallery; showing the built-in gallery instead.', error));
}
