/* ===== Guest Reviews page (reviews.html) =====
   Loads published reviews from /api/reviews and sends new ones for approval.
   Guest text is always inserted with textContent, never as HTML. */
(() => {
  const page = document.querySelector('.reviews-page');
  if (!page) return;

  const starPath = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pageSize = 12;
  const apiAvailable = location.protocol.startsWith('http');

  const el = selector => document.querySelector(selector);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const stars = (rating, size = 14) => {
    const wrap = make('span', 'review-stars');
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', `${rating} out of 5 stars`);
    for (let i = 1; i <= 5; i++) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('class', i <= Math.round(rating) ? 'on' : 'off');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', starPath);
      svg.append(path);
      wrap.append(svg);
    }
    return wrap;
  };
  const visitedLabel = visited => {
    if (!visited) return '';
    const [year, month] = visited.split('-').map(Number);
    return `${monthNames[month - 1]} ${year}`;
  };

  // ----- Published reviews -----
  let allReviews = [];
  let shown = 0;
  const list = el('[data-reviews-list]');
  const moreButton = el('[data-reviews-more]');

  const card = review => {
    const article = make('article', review.featured ? 'review-card featured' : 'review-card');
    const top = make('div', 'review-card-top');
    top.append(stars(review.rating));
    if (review.featured) top.append(make('span', 'review-badge', 'Guest favourite'));
    article.append(top);
    const text = make('p', 'review-card-text');
    text.textContent = `“${review.text}”`;
    article.append(text);
    const author = make('p', 'review-card-author', review.name);
    const meta = [review.stay, visitedLabel(review.visited)].filter(Boolean).join(' · ');
    if (meta) author.append(make('span', 'review-card-meta', meta));
    article.append(author);
    return article;
  };

  const showMore = () => {
    const next = allReviews.slice(shown, shown + pageSize);
    next.forEach((review, index) => {
      const node = card(review);
      node.style.animationDelay = `${index * 60}ms`;
      list.append(node);
    });
    shown += next.length;
    moreButton.hidden = shown >= allReviews.length;
  };
  moreButton?.addEventListener('click', showMore);

  const renderSummary = summary => {
    el('[data-reviews-average]').textContent = summary.count ? summary.average.toFixed(1) : '–';
    const starsSlot = el('[data-reviews-stars]');
    starsSlot.replaceChildren(stars(summary.average || 0, 18));
    el('[data-reviews-count]').textContent = summary.count
      ? `From ${summary.count} guest review${summary.count === 1 ? '' : 's'}`
      : 'No reviews yet';
    const distribution = el('[data-reviews-distribution]');
    distribution.replaceChildren(...[5, 4, 3, 2, 1].map(value => {
      const count = summary.distribution[value] || 0;
      const row = make('li');
      row.append(make('span', 'dist-label', `${value} ★`));
      const track = make('span', 'dist-track');
      const fill = make('span', 'dist-fill');
      fill.style.width = summary.count ? `${(count / summary.count) * 100}%` : '0%';
      track.append(fill);
      row.append(track, make('span', 'dist-count', String(count)));
      row.setAttribute('aria-label', `${value} stars: ${count} review${count === 1 ? '' : 's'}`);
      return row;
    }));
  };

  if (apiAvailable) {
    fetch('/api/reviews', { headers: { Accept: 'application/json' } })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then(data => {
        allReviews = Array.isArray(data.reviews) ? data.reviews : [];
        renderSummary(data.summary || { average: 0, count: 0, distribution: {} });
        el('[data-reviews-empty]').hidden = allReviews.length > 0;
        showMore();
      })
      .catch(() => {
        el('[data-reviews-count]').textContent = 'Reviews could not be loaded right now.';
      });
  }

  // ----- Write a review -----
  const form = el('[data-review-form]');
  if (!form) return;
  const openedAt = Date.now();
  const message = el('[data-review-message]');
  const captions = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Exceptional' };
  const caption = el('[data-rating-caption]');
  const counter = el('[data-review-count]');
  const textArea = form.querySelector('#review-text');

  form.querySelectorAll('input[name="rating"]').forEach(input => {
    input.addEventListener('change', () => { caption.textContent = captions[input.value]; });
  });
  textArea.addEventListener('input', () => { counter.textContent = `${textArea.value.length} / 1500`; });

  const showMessage = (text, isError) => {
    message.textContent = text;
    message.classList.toggle('error', Boolean(isError));
    message.hidden = false;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const rating = Number(data.get('rating'));
    const text = String(data.get('text') || '').trim();
    const name = String(data.get('name') || '').trim();
    if (!rating) return showMessage('Please choose a star rating.', true);
    if (text.length < 10) return showMessage('Please write at least a sentence about your stay.', true);
    if (name.length < 2) return showMessage('Please add your name.', true);
    if (!apiAvailable) return showMessage('Reviews can be sent once the site is online.', true);

    const button = form.querySelector('.review-submit');
    button.disabled = true;
    button.querySelector('span').textContent = 'Sending…';
    message.hidden = true;
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating, text, name,
          stay: String(data.get('stay') || ''),
          visited: String(data.get('visited') || ''),
          website: String(data.get('website') || ''),
          elapsedMs: Date.now() - openedAt,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Your review could not be sent. Please try again.');
      form.hidden = true;
      const thanks = el('[data-review-thanks]');
      thanks.hidden = false;
      thanks.focus();
    } catch (error) {
      showMessage(error.message, true);
      button.disabled = false;
      button.querySelector('span').textContent = 'Send Review';
    }
  });
})();
