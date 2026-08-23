# Bisnesidea-hedelmäpeli

A slot machine that deals out business ideas: **passion × business sector × future scenario**.
Spin, lock any reel you want to keep, spin again. UI text is in Finnish.

Plain HTML, CSS and JS — no build step, no dependencies. Open `index.html` by
double-clicking it, or host the folder anywhere static.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page markup: marquee, reels, button deck, result panel |
| `styles.css` | All styling (the fruit-machine cabinet look) |
| `app.js` | Spin logic, locks, result sentence, sounds |
| `data.js` | **The content** — the three lists |

## Editing the content

Everything the machine can land on lives in `data.js`, as three plain arrays:

```js
const DATA = {
  passions:  ["Juoksu", "Pyöräily", ...],   // reel 1
  sectors:   ["Rakentaminen", ...],         // reel 2
  scenarios: ["energia on ilmaista", ...]   // reel 3
};
```

Add or remove lines freely; the reels and the "mahdollisuuksia" counter follow along.

Two things to keep in mind:

- **Passions and sectors** are used mid-sentence, so write them in the nominative
  ("Juoksu", "Rakentaminen"). The first letter is lower-cased automatically.
- **Scenarios** complete the phrase *"maailmassa, jossa ___"*, so write them as a
  clause: "energia on ilmaista", not "Ilmainen energia".

## Controls

- **PYÖRÄYTÄ** button or <kbd>Space</kbd> — spin
- **LUKITSE** buttons, or <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> — lock a reel so it keeps its
  value through the next spin
- Sound can be toggled bottom right; the setting is remembered per browser

## Publishing on GitHub Pages

1. Create a repository and push these files to its root (`index.html` must be at the top level).
2. In the repository: **Settings → Pages → Build and deployment**.
3. Source: **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

No Jekyll config is needed — the filenames contain nothing Jekyll would skip.
The same folder also works as-is on Netlify, Cloudflare Pages, S3, or any web server.

The one external request the page makes is to Google Fonts. If you would rather have
zero external requests, drop the two `<link ... fonts.googleapis.com ...>` tags from
`index.html`; the layout falls back to system fonts.
