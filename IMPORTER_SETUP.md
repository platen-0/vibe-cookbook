# Smart recipe importer

The cookbook remains a static GitHub Pages app using Firebase Firestore and Auth. A small
Cloudflare Worker performs the operations that cannot safely run in the browser:

- verifies the editor's Firebase ID token;
- fetches public recipe pages and reads JSON-LD/Open Graph metadata;
- sends page text, pasted social text, or screenshots to the OpenAI Responses API;
- returns a structured **draft** for review;
- stores a selected, compressed recipe image in this GitHub repository.

The Worker never writes recipes or tags to Firestore. The browser saves the reviewed draft
using the existing Firestore security rules. Extracting text for an existing recipe updates
only `content.text`; its `tags[]` array is left untouched.

## Cost boundary

This setup does not enable Firebase billing or Firebase Storage. It is designed for the
Cloudflare Workers Free plan and stores images under `images/recipes/` in this repository.
OpenAI API usage is still charged to the OpenAI project that owns `OPENAI_API_KEY`.

## Required secrets

Create a fine-grained GitHub token limited to `platen-0/vibe-cookbook` with:

- Repository permission: **Contents — Read and write**
- No organization or account-wide permissions

The Worker needs two encrypted secrets:

```dotenv
OPENAI_API_KEY=...
GITHUB_TOKEN=...
```

Do not put either value in `import-config.js`, `wrangler.jsonc`, Git history, browser storage,
or a chat message.

## Local development

1. Copy the example secrets file:

   ```bash
   cp worker/.dev.vars.example worker/.dev.vars
   ```

2. Add the two local secret values to `worker/.dev.vars`. This file is ignored by Git.
3. Start the Worker:

   ```bash
   npm run worker:dev
   ```

4. Serve the static app from the repository root. On localhost, the app automatically uses
   `http://localhost:8787` for the importer.
5. Sign in with one of the authorized Firebase editor accounts and test:
   - a recipe website with JSON-LD;
   - an Instagram/Facebook URL plus pasted text;
   - a social screenshot;
   - a manual image upload;
   - category and tag changes before saving.

Run deterministic Worker tests with:

```bash
npm test
```

## Production deployment

1. Sign in to a Cloudflare account and authenticate Wrangler:

   ```bash
   npx wrangler@latest login
   ```

2. Create a temporary ignored file such as `worker/.env.production` containing the two
   secrets shown above.
3. Upload the code and encrypted secrets together:

   ```bash
   npx wrangler@latest deploy \
     --config worker/wrangler.jsonc \
     --secrets-file worker/.env.production
   ```

4. Copy the resulting `https://…workers.dev` URL into `import-config.js`:

   ```js
   window.COOKBOOK_CONFIG = Object.freeze({
     importerUrl: 'https://your-worker-url.workers.dev'
   });
   ```

5. Open Settings in the cookbook. “שירות הייבוא מחובר” confirms that OpenAI and GitHub
   image storage are both configured.
6. Commit and deploy the static app through the normal GitHub Pages workflow. The existing
   pre-commit hook also cache-busts `import-config.js`.
7. Delete `worker/.env.production` after the secrets have been uploaded. Cloudflare retains
   them as encrypted Worker secrets.

## Social media behavior

Instagram and Facebook do not reliably expose captions or comments without Meta
authorization. The importer therefore:

1. attempts public page metadata and image discovery;
2. asks for pasted caption/comment text or up to two screenshots when needed;
3. uses OpenAI text/vision extraction to produce the same editable recipe draft.

No Meta login, cookie, access token, or developer app is used.

## Operational limits

- Uploaded images are converted in the browser to WebP and reduced below 900 KB.
- Remotely extracted images must already be below 950 KB; otherwise the editor is asked to
  upload a smaller copy.
- A repository image commit can take a short time to appear on GitHub Pages.
- Every AI result is review-only. Saving remains an explicit editor action.
- The in-memory rate limit is a best-effort abuse guard per Worker isolate. Firebase
  authentication and the editor allowlist are the primary access controls.
