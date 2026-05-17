document.querySelectorAll('[data-locale]').forEach(function(el) {
  el.addEventListener('click', function(e) {
    e.preventDefault();
    const locale = this.getAttribute('data-locale');
    changeLocale(locale);
  });
});