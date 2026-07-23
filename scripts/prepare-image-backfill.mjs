#!/usr/bin/env node

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { extractPageData } from '../worker/src/index.js';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMAGE_ROOT = join(REPOSITORY_ROOT, 'images', 'recipes');
const REPORT_PATH = join(tmpdir(), 'vibe-cookbook-image-backfill-report.json');
const FFMPEG = '/opt/anaconda3/bin/ffmpeg';
const FFPROBE = '/opt/anaconda3/bin/ffprobe';
const MAX_HTML_BYTES = 5_000_000;
const MAX_SOURCE_IMAGE_BYTES = 20_000_000;
const MAX_FINAL_IMAGE_BYTES = 900_000;
const CONCURRENCY = 6;

function latestBackupPath() {
  const candidates = readdirSync(REPOSITORY_ROOT)
    .filter((name) => /^production-backup-\d{8}T\d{6}Z\.zip$/.test(name))
    .sort()
    .reverse();
  if (!candidates.length) throw new Error('No timestamped production backup was found');
  return join(REPOSITORY_ROOT, candidates[0]);
}

function readRecipesFromBackup(archivePath) {
  const json = execFileSync(
    'unzip',
    ['-p', archivePath, 'data/recipes-normalized.json'],
    { encoding: 'utf8', maxBuffer: 20_000_000 }
  );
  const payload = JSON.parse(json);
  if (!Array.isArray(payload.recipes) || payload.recipes.length === 0) {
    throw new Error('Backup contains no recipes');
  }
  return payload.recipes;
}

function hasCardImage(recipe) {
  return Boolean(
    recipe.content?.uploadedImages?.length ||
      (recipe.content?.images || []).some((path) => !String(path).endsWith('.docx'))
  );
}

function domainFor(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isInstagram(domain) {
  return domain === 'instagram.com' || domain.endsWith('.instagram.com');
}

function isFacebook(domain) {
  return (
    domain === 'facebook.com' ||
    domain.endsWith('.facebook.com') ||
    domain === 'fb.watch'
  );
}

function youtubeId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.endsWith('youtu.be')) return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live'].includes(parts[0])) return parts[1] || '';
    }
  } catch {
    // Invalid source URLs are reported as unresolved below.
  }
  return '';
}

function instagramMediaUrl(rawUrl) {
  const url = new URL(rawUrl);
  const shortcode = url.pathname.split('/').filter(Boolean)[1];
  if (!shortcode) throw new Error('Instagram URL has no post shortcode');
  url.search = '';
  url.hash = '';
  // Instagram's legacy media endpoint serves both posts and reels through /p/.
  url.pathname = `/p/${shortcode}/media/`;
  url.searchParams.set('size', 'l');
  return url.toString();
}

function suspiciousImageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const haystack = `${url.hostname}${url.pathname}`.toLowerCase();
    return /(?:^|[._/-])(avatar|favicon|icon|logo|placeholder|default-image|no-image)(?:[._/-]|$)/.test(
      haystack
    );
  } catch {
    return true;
  }
}

async function fetchWithLimit(url, options, byteLimit) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25_000),
    ...options
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > byteLimit) {
    throw new Error(`response is larger than ${byteLimit} bytes`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > byteLimit) {
    throw new Error(`response exceeded ${byteLimit} bytes`);
  }
  return { response, bytes };
}

async function extractWebsiteCandidates(rawUrl) {
  const { response, bytes } = await fetchWithLimit(
    rawUrl,
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.7',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
      }
    },
    MAX_HTML_BYTES
  );
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().startsWith('image/')) {
    return {
      pageTitle: '',
      finalUrl: response.url || rawUrl,
      candidates: [
        {
          url: response.url || rawUrl,
          source: 'source-url-image',
          referer: rawUrl
        }
      ]
    };
  }
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`source is not HTML (${contentType || 'unknown content type'})`);
  }
  const page = extractPageData(new TextDecoder().decode(bytes), response.url || rawUrl);
  return {
    pageTitle: page.title || '',
    finalUrl: response.url || rawUrl,
    candidates: (page.imageCandidates || []).filter(
      (candidate) => candidate.url && !suspiciousImageUrl(candidate.url)
    )
  };
}

async function imageDimensions(path) {
  const { stdout } = await execFileAsync(
    FFPROBE,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      path
    ],
    { maxBuffer: 100_000 }
  );
  const [width, height] = stdout.trim().split('x').map(Number);
  if (!width || !height) throw new Error('could not read image dimensions');
  return { width, height };
}

async function convertToCardImage(sourcePath, outputPath) {
  const temporaryOutput = `${outputPath}.tmp.jpg`;
  const filters = 'scale=min(1000\\,iw):-2';
  await execFileAsync(
    FFMPEG,
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-vf',
      filters,
      '-frames:v',
      '1',
      '-q:v',
      '5',
      temporaryOutput
    ],
    { maxBuffer: 2_000_000 }
  );

  if (statSync(temporaryOutput).size > MAX_FINAL_IMAGE_BYTES) {
    unlinkSync(temporaryOutput);
    await execFileAsync(
      FFMPEG,
      [
        '-y',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-vf',
        'scale=min(800\\,iw):-2',
        '-frames:v',
        '1',
        '-q:v',
        '8',
        temporaryOutput
      ],
      { maxBuffer: 2_000_000 }
    );
  }

  const dimensions = await imageDimensions(temporaryOutput);
  if (dimensions.width < 260 || dimensions.height < 180) {
    unlinkSync(temporaryOutput);
    throw new Error(`image is too small (${dimensions.width}x${dimensions.height})`);
  }
  if (dimensions.width / dimensions.height > 4 || dimensions.height / dimensions.width > 4) {
    unlinkSync(temporaryOutput);
    throw new Error(`image has an extreme aspect ratio (${dimensions.width}x${dimensions.height})`);
  }
  if (statSync(temporaryOutput).size > MAX_FINAL_IMAGE_BYTES) {
    unlinkSync(temporaryOutput);
    throw new Error('converted image is still too large');
  }

  renameSync(temporaryOutput, outputPath);
  return {
    ...dimensions,
    bytes: statSync(outputPath).size,
    sha256: createHash('sha256').update(readFileSync(outputPath)).digest('hex')
  };
}

async function downloadCandidate(candidate, outputPath) {
  const { response, bytes } = await fetchWithLimit(
    candidate.url,
    {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*',
        Referer: candidate.referer || '',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
      }
    },
    MAX_SOURCE_IMAGE_BYTES
  );
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error(`candidate is not an image (${contentType || 'unknown content type'})`);
  }

  const extension =
    contentType.includes('png')
      ? '.png'
      : contentType.includes('webp')
        ? '.webp'
        : contentType.includes('avif')
          ? '.avif'
          : '.jpg';
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'vibe-cookbook-image-'));
  const sourcePath = join(temporaryRoot, `source${extension}`);
  try {
    writeFileSync(sourcePath, bytes);
    return await convertToCardImage(sourcePath, outputPath);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function candidatesForRecipe(recipe) {
  const rawUrl = recipe.content?.url || '';
  if (!rawUrl) {
    return { status: 'unresolved', reason: 'no-source-url', candidates: [] };
  }

  const domain = domainFor(rawUrl);
  if (isFacebook(domain)) {
    return {
      status: 'unresolved',
      reason: 'facebook-needs-visual-review',
      candidates: []
    };
  }

  if (isInstagram(domain)) {
    return {
      status: 'candidate',
      reason: '',
      finalUrl: rawUrl,
      pageTitle: recipe.name,
      candidates: [
        {
          url: instagramMediaUrl(rawUrl),
          source: 'instagram-post',
          referer: rawUrl
        }
      ]
    };
  }

  const videoId = youtubeId(rawUrl);
  if (videoId) {
    return {
      status: 'candidate',
      reason: '',
      finalUrl: rawUrl,
      pageTitle: recipe.name,
      candidates: [
        {
          url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
          source: 'youtube-thumbnail',
          referer: rawUrl
        },
        {
          url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          source: 'youtube-thumbnail',
          referer: rawUrl
        }
      ]
    };
  }

  try {
    const extracted = await extractWebsiteCandidates(rawUrl);
    if (!extracted.candidates.length) {
      return {
        status: 'unresolved',
        reason: 'page-exposed-no-recipe-image',
        ...extracted
      };
    }
    return { status: 'candidate', reason: '', ...extracted };
  } catch (error) {
    return {
      status: 'unresolved',
      reason: `page-fetch-failed: ${error.message}`,
      candidates: []
    };
  }
}

async function prepareRecipe(recipe) {
  const outputPath = join(IMAGE_ROOT, `${recipe.id}.jpg`);
  if (existsSync(outputPath)) {
    const image = await imageDimensions(outputPath);
    return {
      id: recipe.id,
      name: recipe.name,
      sourceUrl: recipe.content?.url || '',
      status: 'prepared',
      reason: 'local-image-already-exists',
      outputPath,
      publicPath: `images/recipes/${recipe.id}.jpg`,
      candidateSource: 'previous-pass',
      bytes: statSync(outputPath).size,
      sha256: createHash('sha256').update(readFileSync(outputPath)).digest('hex'),
      ...image
    };
  }

  const extraction = await candidatesForRecipe(recipe);
  if (extraction.status !== 'candidate') {
    return {
      id: recipe.id,
      name: recipe.name,
      sourceUrl: recipe.content?.url || '',
      status: extraction.status,
      reason: extraction.reason,
      pageTitle: extraction.pageTitle || '',
      finalUrl: extraction.finalUrl || ''
    };
  }

  const errors = [];
  for (const candidate of extraction.candidates) {
    try {
      const image = await downloadCandidate(
        { ...candidate, referer: candidate.referer || extraction.finalUrl },
        outputPath
      );
      return {
        id: recipe.id,
        name: recipe.name,
        sourceUrl: recipe.content?.url || '',
        status: 'prepared',
        reason: '',
        pageTitle: extraction.pageTitle || '',
        finalUrl: extraction.finalUrl || '',
        candidateUrl: candidate.url,
        candidateSource: candidate.source,
        outputPath,
        publicPath: `images/recipes/${recipe.id}.jpg`,
        ...image
      };
    } catch (error) {
      errors.push(`${candidate.source}: ${error.message}`);
    }
  }

  return {
    id: recipe.id,
    name: recipe.name,
    sourceUrl: recipe.content?.url || '',
    status: 'unresolved',
    reason: `image-download-failed: ${errors.join('; ')}`,
    pageTitle: extraction.pageTitle || '',
    finalUrl: extraction.finalUrl || ''
  };
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) {
  throw new Error('ffmpeg and ffprobe are required for safe image normalization');
}

const backupPath = latestBackupPath();
const recipes = readRecipesFromBackup(backupPath);
const missing = recipes.filter((recipe) => !hasCardImage(recipe));
mkdirSync(IMAGE_ROOT, { recursive: true });

console.log(`Preparing source images for ${missing.length} recipes from ${basename(backupPath)}...`);
const entries = await mapConcurrent(missing, CONCURRENCY, prepareRecipe);

const candidateOwners = new Map();
for (const entry of entries) {
  if (entry.status !== 'prepared' || !entry.candidateUrl) continue;
  const key = entry.candidateUrl;
  if (!candidateOwners.has(key)) candidateOwners.set(key, []);
  candidateOwners.get(key).push(entry.id);
}
for (const entry of entries) {
  if (entry.status !== 'prepared' || !entry.candidateUrl) continue;
  entry.sharedCandidateWith = (candidateOwners.get(entry.candidateUrl) || []).filter(
    (id) => id !== entry.id
  );
}

const summary = entries.reduce(
  (totals, entry) => {
    totals[entry.status] = (totals[entry.status] || 0) + 1;
    return totals;
  },
  { total: entries.length }
);
const report = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  backupPath,
  imageRoot: IMAGE_ROOT,
  publicBase: 'https://platen-0.github.io/vibe-cookbook/',
  summary,
  entries
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ reportPath: REPORT_PATH, summary }, null, 2));
