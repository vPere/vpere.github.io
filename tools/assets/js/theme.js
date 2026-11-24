// Follows the theme chosen on the main site (shared localStorage key).
// Must be loaded synchronously in <head>, right after the #theme-link <link>.
(function () {
  var dark = true;
  try { dark = localStorage.getItem('vpere-theme') !== 'light'; } catch (e) {}
  var link = document.getElementById('theme-link');
  if (link) link.href = 'assets/styles/colors_' + (dark ? 'dark' : 'light') + '_slate.css';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
