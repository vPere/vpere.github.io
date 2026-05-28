document.querySelectorAll('[data-locale]').forEach(function(el) {
  el.addEventListener('click', function(e) {
    e.preventDefault();
    const locale = this.getAttribute('data-locale');
    changeLocale(locale);
  });
});

// ── Mobile nav toggle ────────────────────────────────────────────────────────
const navToggle = document.getElementById('navToggle');
const mobileNav = document.getElementById('mobileNav');

navToggle.addEventListener('click', () => mobileNav.classList.toggle('open'));
mobileNav.querySelectorAll('.nav-link').forEach(l =>
  l.addEventListener('click', () => mobileNav.classList.remove('open'))
);

// ── Dark / light theme toggle ─────────────────────────────────────────────────
const DARK_HREF   = './assets/styles/colors_dark_orange.css';
const LIGHT_HREF  = './assets/styles/colors_light_green.css';
const STORAGE_KEY = 'vpere-theme';

const themeLink = document.getElementById('theme-link');
const themeIcon = document.getElementById('themeIcon');
const themeBtn  = document.getElementById('themeToggle');

function applyTheme(dark) {
  themeLink.href        = dark ? DARK_HREF : LIGHT_HREF;
  themeIcon.textContent = dark ? '☀︎' : '☾';
  localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
}

// Restore saved preference on load (default: dark)
const savedTheme = localStorage.getItem(STORAGE_KEY);
applyTheme(savedTheme !== 'light');

// Wire up the button
themeBtn.addEventListener('click', () => {
  const isDark = themeLink.href.includes('colors_dark_orange');
  applyTheme(!isDark);
});