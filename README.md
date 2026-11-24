# vPere's GitHub Page

Personal website of Pere Vidiella, published with GitHub Pages at <https://vpere.github.io>.

## What's inside

- **Home page**: research, experience, a photography gallery and my rally activity, available in English, Catalan and Spanish, with light and dark themes.
- **Tools**: small browser-based utilities (`tools/`), such as an ECB mode demo, an image metadata viewer and Linder.
- **Watchfaces**: my watchface projects (`watchfaces/`).

## Structure

```
index.html            main page
assets/styles/        stylesheets and light/dark colour palettes
assets/js/            theme switcher, i18n loader, lightbox
assets/translations/  en / ca / es strings
assets/images/        profile, gallery and rally photos
tools/                standalone tools
```

## Running locally

It's a static site, so any web server works:

```
python -m http.server 8000
```

Then open <http://localhost:8000>.
