# Tal's Cookbook App

Hebrew recipe cookbook web app with recipes from Instagram, YouTube, Facebook, and text entries.

## Links

- **Live App**: https://platen-0.github.io/vibe-cookbook/
- **GitHub Repo**: https://github.com/platen-0/vibe-cookbook
- **Firebase Console**: https://console.firebase.google.com/project/vibe-cookbook

## Tech Stack

Vanilla HTML/CSS/JS, Firebase Firestore + Auth, GitHub Pages hosting, RTL Hebrew layout.

## Key Files

| File | Purpose |
|------|---------|
| `app.js` | Main app logic, Firebase integration, theme toggle |
| `styles.css` | Mediterranean Kitchen design system, dark mode |
| `batch-extract.js` | Browser console script: `batchExtract(20)` |
| `restore-tags.js` | Browser console script: `restoreTags()` |

## Authorized Editors

taladani@gmail.com, eliavschreiber@gmail.com, dschreiber@gmail.com, gidonschreiber@gmail.com, egorlin@gmail.com

## Architecture

### Design System (Jan 2025)
- **Aesthetic**: Mediterranean Kitchen - terracotta/earth palette, Heebo + Playfair Display fonts
- **Dark mode**: Manual toggle (light/dark/auto) in settings, uses CSS variables
- **Mobile**: Fully responsive with compact layout at 600px breakpoint

### Categories
Hierarchical: Main (breakfast, lunch-dinner, dessert, snacks, baby) → Sub-categories
- Editors can add/delete categories and sub-categories via Settings
- Deletion blocked if recipes exist in category

### Tags
- **Person tags** (always visible): `tal`, `einav` - auto-assigned based on logged-in user
- **Auto-detected tags**: vegetarian, vegan, gluten-free, parve, kid-friendly, quick, healthy
- Tags stored in Firebase `recipe.tags[]` array

### Recipe Text
- Unified field: `content.text` (reads from `content.transcription` for backward compat)
- New text always saves to `content.text`

### Editing (Authorized Users)
- **Edit Details**: Change recipe name and sub-category via "✏️ ערוך פרטים" button
- **Edit Tags**: Modify recipe tags via "🏷️ ערוך תגיות" button
- **Edit Text**: Add/edit recipe text via "📝" buttons
- **Category Management**: Settings → only visible to authorized editors

## Known Limitations

### Recipe Extraction
- Only works for sites with JSON-LD Recipe schema or common CSS selectors
- Most Hebrew sites (matkonia.co.il, oogio.net, etc.) fail extraction
- CORS proxies unreliable
- **Workaround**: Manual text entry via "הוסף טקסט מתכון" button

### Social Media
- Instagram/Facebook/YouTube/TikTok require manual text entry (29 recipes affected)

### Private Browsing / Offline
- localStorage unavailable - theme preferences won't persist
- Firebase persistence disabled - recipes load fresh from Firestore each time
- If Firestore fails, falls back to `recipes.json` with warning banner (editing disabled)
- Run `node sync-recipes.js` to update recipes.json from Firebase

## Recipe Stats (Jan 2025)

149 total | 45 with text | 62 websites without | 29 social media without

## Deployment

iOS PWA aggressively caches files. A pre-commit hook auto-updates `?v=HASH` query params in index.html when app.js or styles.css change.

### First-time setup (required per machine)
```bash
cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

### Standard deploy
```bash
git add . && git commit -m "msg" && git push origin main
```

The pre-commit hook computes MD5 hashes of app.js/styles.css and updates index.html automatically. No manual version bumping needed.

## Future Work

- [ ] Server-side recipe extraction (requires moving off GitHub Pages)
- [ ] OpenAI Whisper for video transcription
- [ ] Image upload (requires Firebase Blaze plan)
