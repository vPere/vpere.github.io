function loadLocale(locale) {
    i18next.use(i18nextXHRBackend).init({
        lng: locale,
        fallbackLng: 'ca',
        backend: {
            loadPath: '/i18n/{{lng}}.json'
        }
    }, function (err, t) {
        if (err) {
            console.error('Failed to load translations:', err);
            return;
        }

        const translateElements = document.querySelectorAll('[data-i18n]');
        translateElements.forEach(element => {
            const translationKey = element.getAttribute('data-i18n');
            element.textContent = t(translationKey);
        });
    });
}

function getLang() {
    if (navigator.languages !== undefined)
        return checkLangAvailable(navigator.languages[0].toLocaleLowerCase().substring(0, 2));
    return checkLangAvailable(navigator.language.toLocaleLowerCase().substring(0, 2));
}

function checkLangAvailable(lang) {
    const availableLocales = ['ca', 'es', 'en'];
    if (!availableLocales.includes(lang)) {
        return 'en';
    }
    return lang;
}

const initialLocale = getLang();
loadLocale(initialLocale);
