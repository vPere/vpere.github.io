function updateContent(t) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = t(key);
    if (translation && translation !== key) {
      el.textContent = translation;
    }
  });
}

function getInitialLang() {
  const available = ['ca', 'es', 'en'];
  const browserLangs = navigator.languages
    ? navigator.languages.map(l => l.toLowerCase().substring(0, 2))
    : [navigator.language.toLowerCase().substring(0, 2)];

  for (const lang of browserLangs) {
    if (available.includes(lang)) return lang;
  }
  return 'ca';
}

i18next
  .use(i18nextHttpBackend)
  .init({
    lng: getInitialLang(),
    fallbackLng: 'ca',
    supportedLngs: ['ca', 'es', 'en'],
    backend: {
      loadPath: '/assets/translations/{{lng}}.json'
    }
  }, function(err, t) {
    if (err) {
      console.error('i18n init failed:', err);
      return;
    }
    updateContent(t);
  });

/* Called by main.js language switcher */
function changeLocale(locale) {
  i18next.changeLanguage(locale, function(err, t) {
    if (err) {
      console.error('Language change failed:', err);
      return;
    }
    updateContent(t);
  });
}