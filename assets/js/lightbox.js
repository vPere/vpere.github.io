// Minimal lightbox for links marked with [data-lightbox]
(function () {
  const items = Array.from(document.querySelectorAll('a[data-lightbox]'));
  if (!items.length) return;

  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.innerHTML = '<button class="lb-close" aria-label="Close">×</button>' +
    '<button class="lb-prev" aria-label="Previous">‹</button>' +
    '<img alt="">' +
    '<button class="lb-next" aria-label="Next">›</button>';
  document.body.appendChild(box);
  const img = box.querySelector('img');
  let index = 0;

  function show(i) {
    index = (i + items.length) % items.length;
    const thumb = items[index].querySelector('img');
    img.src = items[index].getAttribute('href');
    img.alt = thumb ? thumb.alt : '';
  }
  function open(i) { show(i); box.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() { box.classList.remove('open'); document.body.style.overflow = ''; img.removeAttribute('src'); }

  items.forEach((a, i) => a.addEventListener('click', e => { e.preventDefault(); open(i); }));
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev').addEventListener('click', e => { e.stopPropagation(); show(index - 1); });
  box.querySelector('.lb-next').addEventListener('click', e => { e.stopPropagation(); show(index + 1); });
  box.addEventListener('click', e => { if (e.target === box) close(); });
  document.addEventListener('keydown', e => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  });
})();
