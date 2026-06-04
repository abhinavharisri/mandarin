/* ============================================================
   MANDARIN ORCHID RESORT — Main JavaScript
   ============================================================ */

/* ===== Page Loader ===== */
const loader = document.querySelector('.page-loader');
if (loader) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      loader.classList.add('hidden');
      document.body.classList.remove('loading');
    }, 1800);
  });
}

/* ===== Custom Cursor ===== */
const cursorOuter = document.querySelector('.cursor-outer');
const cursorInner = document.querySelector('.cursor-inner');

if (cursorOuter && cursorInner) {
  let mouseX = 0, mouseY = 0;
  let outerX = 0, outerY = 0;

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    cursorInner.style.left = mouseX + 'px';
    cursorInner.style.top  = mouseY + 'px';
  });

  const animateCursor = () => {
    outerX += (mouseX - outerX) * 0.12;
    outerY += (mouseY - outerY) * 0.12;
    cursorOuter.style.left = outerX + 'px';
    cursorOuter.style.top  = outerY + 'px';
    requestAnimationFrame(animateCursor);
  };
  animateCursor();

  // Cursor scale on interactive elements
  document.querySelectorAll('a, button, [data-cursor]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursorOuter.style.width  = '60px';
      cursorOuter.style.height = '60px';
      cursorOuter.style.borderColor = 'rgba(196,150,60,0.4)';
      cursorInner.style.width  = '3px';
      cursorInner.style.height = '3px';
    });
    el.addEventListener('mouseleave', () => {
      cursorOuter.style.width  = '36px';
      cursorOuter.style.height = '36px';
      cursorOuter.style.borderColor = 'var(--gold)';
      cursorInner.style.width  = '6px';
      cursorInner.style.height = '6px';
    });
  });
}

/* ===== Sticky Nav ===== */
const siteNav = document.querySelector('.site-nav');
if (siteNav) {
  window.addEventListener('scroll', () => {
    siteNav.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });
}

/* ===== Mobile Menu ===== */
const navToggle = document.querySelector('.nav-toggle');
const mobileNav = document.querySelector('.mobile-nav');
const mobileClose = document.querySelector('.mobile-nav-close');

if (navToggle && mobileNav) {
  navToggle.addEventListener('click', () => mobileNav.classList.add('open'));
  if (mobileClose) mobileClose.addEventListener('click', () => mobileNav.classList.remove('open'));
  mobileNav.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
  });
}

/* ===== Scroll Reveal (IntersectionObserver) ===== */
const reveals = document.querySelectorAll('[data-reveal]');
if (reveals.length) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  reveals.forEach(el => revealObserver.observe(el));
}

/* ===== Parallax ===== */
const parallaxEls = document.querySelectorAll('[data-parallax]');
if (parallaxEls.length) {
  const handleParallax = () => {
    parallaxEls.forEach(el => {
      const rect   = el.closest('[data-parallax-container]')?.getBoundingClientRect()
                  || el.getBoundingClientRect();
      const speed  = parseFloat(el.dataset.parallax) || 0.4;
      const center = rect.top + rect.height / 2 - window.innerHeight / 2;
      el.style.transform = `translateY(${center * speed}px)`;
    });
  };
  window.addEventListener('scroll', handleParallax, { passive: true });
  handleParallax();
}

/* ===== Hero Slider ===== */
const heroSlider = document.querySelector('.hero-slides');
if (heroSlider) {
  const slides  = heroSlider.querySelectorAll('.hero-slide');
  const dots    = document.querySelectorAll('.hero-dot');
  let current   = 0;
  let timer;

  const goTo = idx => {
    slides[current].classList.remove('active');
    dots[current]?.classList.remove('active');
    current = (idx + slides.length) % slides.length;
    slides[current].classList.add('active');
    dots[current]?.classList.add('active');
  };

  const next = () => goTo(current + 1);
  const startTimer = () => { clearInterval(timer); timer = setInterval(next, 5500); };

  document.querySelector('.hero-arrow-next')?.addEventListener('click', () => { next(); startTimer(); });
  document.querySelector('.hero-arrow-prev')?.addEventListener('click', () => { goTo(current - 1); startTimer(); });
  dots.forEach((dot, i) => dot.addEventListener('click', () => { goTo(i); startTimer(); }));

  startTimer();
}

/* ===== Generic Carousel ===== */
document.querySelectorAll('.carousel-section').forEach(section => {
  const track = section.querySelector('.carousel-track');
  const slides = track?.querySelectorAll('.carousel-slide');
  if (!track || !slides?.length) return;

  let idx = 0;
  const move = dir => {
    idx = (idx + dir + slides.length) % slides.length;
    track.style.transform = `translateX(-${idx * 100}%)`;
  };

  section.querySelector('.carousel-btn-prev')?.addEventListener('click', () => move(-1));
  section.querySelector('.carousel-btn-next')?.addEventListener('click', () => move(1));

  setInterval(() => move(1), 6000);
});

/* ===== Testimonials Carousel ===== */
const testimonialSection = document.querySelector('.testimonials-section');
if (testimonialSection) {
  const slides = testimonialSection.querySelectorAll('.testimonial-slide');
  const dots   = testimonialSection.querySelectorAll('.t-dot');
  let tIdx = 0;

  const goT = idx => {
    slides[tIdx].classList.remove('active');
    dots[tIdx]?.classList.remove('active');
    tIdx = (idx + slides.length) % slides.length;
    slides[tIdx].classList.add('active');
    dots[tIdx]?.classList.add('active');
  };

  dots.forEach((dot, i) => dot.addEventListener('click', () => goT(i)));
  setInterval(() => goT(tIdx + 1), 6000);
}

/* ===== Room Carousel ===== */
document.querySelectorAll('.room-carousel').forEach(carousel => {
  const imgs = carousel.querySelectorAll('.room-carousel-img');
  const prev = carousel.querySelector('.room-carousel-prev');
  const next = carousel.querySelector('.room-carousel-next');
  if (!imgs.length) return;

  let idx = 0;
  const showSlide = (newIdx) => {
    imgs.forEach((img, i) => img.style.opacity = i === newIdx ? '1' : '0');
  };

  prev?.addEventListener('click', (e) => {
    e.stopPropagation();
    idx = (idx - 1 + imgs.length) % imgs.length;
    showSlide(idx);
  });

  next?.addEventListener('click', (e) => {
    e.stopPropagation();
    idx = (idx + 1) % imgs.length;
    showSlide(idx);
  });

  showSlide(idx);
  setInterval(() => {
    idx = (idx + 1) % imgs.length;
    showSlide(idx);
  }, 5000);
});

/* ===== Fine Dining Carousel ===== */
const fineDiningCarouselImgs = document.querySelectorAll('.fine-dining-carousel-img');
const fineDiningPrevBtn = document.querySelector('.fine-dining-prev');
const fineDiningNextBtn = document.querySelector('.fine-dining-next');
if (fineDiningCarouselImgs.length > 0) {
  let fineDiningIdx = 0;
  const showFineDiningSlide = (idx) => {
    fineDiningCarouselImgs.forEach(img => img.style.opacity = '0');
    fineDiningCarouselImgs[idx].style.opacity = '1';
  };
  const moveFineDining = (dir) => {
    fineDiningIdx = (fineDiningIdx + dir + fineDiningCarouselImgs.length) % fineDiningCarouselImgs.length;
    showFineDiningSlide(fineDiningIdx);
  };
  fineDiningPrevBtn?.addEventListener('click', (e) => { e.stopPropagation(); moveFineDining(-1); });
  fineDiningNextBtn?.addEventListener('click', (e) => { e.stopPropagation(); moveFineDining(1); });
  setInterval(() => moveFineDining(1), 5000);
}

/* ===== Contact Form WhatsApp Link ===== */
const contactForm = document.querySelector('#contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', event => {
    event.preventDefault();

    const firstName = document.querySelector('#first-name')?.value.trim() || '';
    const lastName = document.querySelector('#last-name')?.value.trim() || '';
    const email = document.querySelector('#email')?.value.trim() || '';
    const phone = document.querySelector('#phone')?.value.trim() || '';
    const checkIn = document.querySelector('#check-in')?.value || '';
    const checkOut = document.querySelector('#check-out')?.value || '';
    const roomType = document.querySelector('#room-type')?.value || 'a room';
    const guestCount = document.querySelector('#guest-count')?.value || '1 Guest';
    const userMessage = document.querySelector('#user-message')?.value.trim() || 'No special requests.';

    if (!firstName || !email) {
      alert('Please enter your first name and email address to send the message.');
      return;
    }

    const fullName = `${firstName}${lastName ? ' ' + lastName : ''}`;
    const checkInText = checkIn ? `Check-in: ${checkIn}` : 'Check-in date: not specified';
    const checkOutText = checkOut ? `Check-out: ${checkOut}` : 'Check-out date: not specified';

    const messageText = `Hello Mandarin Orchid team.\n\nMy name is ${fullName}.\n${checkInText}\n${checkOutText}\nGuests: ${guestCount}\nRoom type: ${roomType}\n\nMessage / Special Requests:\n${userMessage}\n\nPlease let me know availability, best rates, and any recommendations for a tranquil stay in Kotagiri. You can reach me at ${email}${phone ? ` or ${phone}` : ''}.\n\nThank you!`;
    const whatsappMessage = encodeURIComponent(messageText);
    const whatsappNumber = '916369233305';
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${whatsappNumber}&text=${whatsappMessage}`;
    window.open(whatsappUrl, '_blank');
  });
}

/* ===== FAQ Accordion ===== */
document.querySelectorAll('.faq-question').forEach(q => {
  q.addEventListener('click', () => {
    const isOpen = q.classList.contains('open');
    // Close all
    document.querySelectorAll('.faq-question').forEach(other => {
      other.classList.remove('open');
      other.nextElementSibling?.classList.remove('open');
    });
    // Toggle clicked
    if (!isOpen) {
      q.classList.add('open');
      q.nextElementSibling?.classList.add('open');
    }
  });
});

/* ===== Counter Animation ===== */
const counters = document.querySelectorAll('[data-counter]');
if (counters.length) {
  const counterObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el  = entry.target;
      const end = parseInt(el.dataset.counter);
      const dur = 2000;
      const start = Date.now();

      const update = () => {
        const progress = Math.min((Date.now() - start) / dur, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.floor(ease * end) + (el.dataset.suffix || '');
        if (progress < 1) requestAnimationFrame(update);
      };
      requestAnimationFrame(update);
      counterObs.unobserve(el);
    });
  }, { threshold: 0.5 });
  counters.forEach(c => counterObs.observe(c));
}

/* ===== Gallery Lightbox ===== */
const lightbox = document.querySelector('.lightbox');
if (lightbox) {
  const lbImg   = lightbox.querySelector('.lightbox-img');
  const lbClose = lightbox.querySelector('.lightbox-close');

  document.querySelectorAll('[data-lightbox]').forEach(item => {
    item.addEventListener('click', () => {
      const src = item.querySelector('img')?.src || item.dataset.lightbox;
      if (lbImg && src) {
        lbImg.src = src;
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  const closeLb = () => {
    lightbox.classList.remove('open');
    document.body.style.overflow = '';
  };

  lbClose?.addEventListener('click', closeLb);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLb(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });
}

/* ===== Active Nav Link ===== */
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
document.querySelectorAll('.nav-link').forEach(link => {
  const href = link.getAttribute('href');
  if (href === currentPage || (currentPage === '' && href === 'index.html')) {
    link.classList.add('active');
  }
});

/* ===== Smooth Anchor Scroll ===== */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const target = document.querySelector(a.getAttribute('href'));
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
