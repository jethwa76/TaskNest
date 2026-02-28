# TaskFlow — Offline-First Task Manager

> Premium, distraction-free task management. No account. No server. Pure local-first.

---

## ✨ Features

- **100% Offline-First** — Works without internet after first load (Service Worker + localStorage)
- **No Login / No Signup** — All data lives on your device
- **PWA Installable** — Add to home screen on mobile or desktop
- **Natural Language Input** — Type `Meeting tomorrow 9am #work !high` and it parses
- **Full CRUD** — Create, edit, complete, delete, bulk-actions
- **Drag & Drop** — Reorder tasks
- **Filters & Search** — By priority, due date, tags, fuzzy text search
- **Export / Import** — JSON and CSV backup/restore
- **Light / Dark / System** theme with accent color picker
- **Keyboard Shortcuts** — `N` new, `/` search, `Esc` close, `T` toggle theme
- **WCAG AA** — Full keyboard navigation, focus states, ARIA labels

---

## 🚀 Quick Start

### Option 1 — Open Directly

Just open `index.html` in any modern browser. Done.

```
open index.html
```

### Option 2 — Local Dev Server (recommended for PWA features)

```bash
# Python
python3 -m http.server 3000

# Node
npx serve .

# PHP
php -S localhost:3000
```

Then visit `http://localhost:3000`

### Service Worker (offline caching)

Service Workers require `localhost` or HTTPS. Using the commands above enables full offline support. On direct file open (`file://`), the SW won't register but the app still works via localStorage.

---

## 📦 Deployment

### Netlify (recommended)

```bash
# Drag & drop the folder into netlify.com/drop
# or via CLI:
npx netlify-cli deploy --prod --dir .
```

### Vercel

```bash
npx vercel --prod
```

### GitHub Pages

1. Push to a GitHub repo
2. Go to Settings → Pages → Source: main branch / root
3. Your app is live at `https://username.github.io/repo-name`

### Any Static Host

Upload all 5 files (`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.json`) to any static hosting.

---

## 📁 File Structure

```
taskflow/
├── index.html      # App shell, all HTML
├── styles.css      # Design system + all component styles
├── app.js          # All application logic (pure JS, no dependencies)
├── sw.js           # Service Worker for offline caching
├── manifest.json   # PWA manifest
└── README.md
```

---

## ⌨️ Keyboard Shortcuts

| Key       | Action              |
|-----------|---------------------|
| `N`       | New task            |
| `/`       | Focus search        |
| `T`       | Toggle theme        |
| `Esc`     | Close dialog        |
| `?`       | Go to Settings      |
| `Enter`   | Save task (in modal)|
| `⌘/Ctrl+Click` | Multi-select task |

---

## 🧠 Natural Language Quick Entry

In the Add Task dialog, type naturally:

| Input | Parsed as |
|-------|-----------|
| `Meeting tomorrow 9am` | Due: tomorrow 9:00 AM |
| `Call doctor today #health !high` | Due: today, tag: health, priority: High |
| `Review report next week #work` | Due: next week, tag: work |

---

## 💾 Data

All data is stored in `localStorage`:
- `tf_tasks` — Task array (JSON)
- `tf_settings` — App settings
- `tf_seeded` — First-run flag

**Export:** Settings → Data Management → Export JSON/CSV  
**Import:** Settings → Data Management → Import (JSON only)  
**Clear:** Settings → Data Management → Clear All (irreversible)

---

## 🔒 Privacy

- Zero network requests for data
- No analytics, no tracking, no ads
- All data stays in your browser
- Fonts loaded from Google Fonts (optional — can be removed for full offline)

---

## 🛠️ Tech Stack

| Concern | Tech |
|---------|------|
| Frontend | Vanilla HTML + CSS + JavaScript (ES2020) |
| Persistence | localStorage |
| Offline | Service Worker (Cache API) |
| PWA | Web App Manifest |
| Fonts | DM Sans + DM Mono (Google Fonts) |
| Zero dependencies | ✓ |

---

## 🧪 Testing (Manual)

1. **Offline mode:** Open DevTools → Network → Offline → reload — app loads ✓
2. **Data persistence:** Add tasks → close browser → reopen → tasks remain ✓
3. **Export/Import:** Export JSON → Clear all → Import → tasks restore ✓
4. **PWA install:** Serve on localhost → DevTools → Application → Manifest → "Add to homescreen" ✓
5. **Keyboard shortcuts:** `N` opens modal, `/` focuses search, `Esc` closes ✓

---

## 🎨 Customization

To change the default accent color, edit in `app.js`:
```js
const defaults = {
  accent: 'indigo', // Options: indigo | blue | emerald | rose | amber
  theme: 'dark',    // Options: dark | light | system
  ...
};
```

To add new accent colors, add CSS variables in `styles.css` under `/* Accent variants */` and a new `.swatch` button in `index.html`.

---

*TaskFlow v1.0 · Offline-First · No Account Required*
