import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, appendFile, writeFile, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_FILE = path.join(__dirname, 'data', 'history.jsonl');
const CONTEXT_JSONL_FILE = path.join(__dirname, 'data', 'context.jsonl');
const LEGACY_CONTEXT_FILE = path.join(__dirname, 'data', 'context.json');
const CONTEXT_EMBEDDINGS_FILE = path.join(__dirname, 'data', 'context_embeddings.json');
const GLOSSARY_FILE = path.join(__dirname, 'data', 'glossary.json');
const RUNTIME_CONFIG_FILE = path.join(__dirname, 'data', 'runtime_config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_CONTEXT_FILE_BYTES = 20 * 1024 * 1024;
const CONTEXT_CHUNK_CHARS = 680;
const CONTEXT_CHUNK_OVERLAP = 140;
const CONTEXT_QUERY_LIMIT = 4;
const CONTEXT_PREVIEW_DEFAULT_LIMIT = 3200;
const CONTEXT_PREVIEW_MAX_LIMIT = 12000;
const CONTEXT_EMBEDDING_BATCH_SIZE = 32;
const CONTEXT_EMBEDDING_DIMENSIONS = 512;
const GLOSSARY_MAX_ITEMS = 400;
const RECENT_TRANSLATION_MAX = 8;
const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiTranslationModel: 'gpt-4.1-mini',
  openaiEmbeddingModel: 'text-embedding-3-small',
  openaiTranscribeLowModel: 'gpt-4o-mini-transcribe',
  openaiTranscribeHighModel: 'gpt-4o-transcribe'
});
const SUPPORTED_LANGUAGE_CODES = new Set(['auto', 'ja', 'en', 'zh', 'ko', 'es', 'fr', 'de', 'it', 'pt']);
const LANGUAGE_NAMES = {
  auto: 'auto-detected language',
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese'
};

const MIME_EXT = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/ogg': 'ogg',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const CONTEXT_MIME_BY_EXT = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

let runtimeConfig = createRuntimeConfigFromEnv();
let contextLibrary = createEmptyContextLibrary();
let contextEmbeddingsStore = createEmptyContextEmbeddingsStore();
let glossaryLibrary = createEmptyGlossaryLibrary();
const recentTranslationMemory = [];
const queryEmbeddingCache = new Map();

export async function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  await mkdir(path.join(__dirname, 'data'), { recursive: true });
  await loadPersistedRuntimeConfig().catch((error) => {
    console.warn('[WARN] Failed to load persisted runtime config:', error?.message || error);
  });
  if (!runtimeConfig.openaiApiKey) {
    console.warn('[WARN] OPENAI_API_KEY is not set. API requests will fail until you set it.');
  }
  await loadPersistedContext().catch((error) => {
    console.warn('[WARN] Failed to load persisted context:', error?.message || error);
  });
  await loadPersistedGlossary().catch((error) => {
    console.warn('[WARN] Failed to load persisted glossary:', error?.message || error);
  });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/transcribe') {
        await handleTranscribe(req, res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/translate') {
        await handleTranslate(req, res);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/runtime-config')) {
        await handleGetRuntimeConfig(res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/runtime-config') {
        await handleSetRuntimeConfig(req, res);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/context')) {
        await handleGetContext(req, res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/context') {
        await handleSetContext(req, res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/context/active') {
        await handleSetContextActive(req, res);
        return;
      }

      if (req.method === 'DELETE' && req.url?.startsWith('/api/context')) {
        await handleDeleteContext(req, res);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/glossary')) {
        await handleGetGlossary(req, res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/glossary') {
        await handleAddGlossary(req, res);
        return;
      }

      if (req.method === 'POST' && req.url === '/api/glossary/toggle') {
        await handleToggleGlossary(req, res);
        return;
      }

      if (req.method === 'DELETE' && req.url?.startsWith('/api/glossary')) {
        await handleDeleteGlossary(req, res);
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/history')) {
        await handleHistory(req, res, port);
        return;
      }

      if (req.method === 'GET') {
        await serveStatic(req, res);
        return;
      }

      json(res, 405, { error: 'Method Not Allowed' });
    } catch (error) {
      console.error('[ERROR]', error);
      json(res, 500, { error: 'Internal Server Error' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Server running at http://${displayHost}:${port}`);
  return { server, port, host };
}

if (isMainModule()) {
  startServer().catch((error) => {
    console.error('[FATAL]', error);
    process.exit(1);
  });
}

async function handleTranscribe(req, res) {
  if (!runtimeConfig.openaiApiKey) {
    json(res, 500, { error: 'OPENAI_API_KEY is not configured on server.' });
    return;
  }

  const body = await readJson(req);
  const audioBase64 = body?.audioBase64;
  const mimeType = String(body?.mimeType || 'audio/webm');
  const mode = body?.mode === 'high_accuracy' ? 'high_accuracy' : 'low_latency';
  const sourceLanguage = normalizeLanguageCode(body?.sourceLanguage, { allowAuto: true, fallback: 'ja' });
  const useContextForTranscription = body?.useContextForTranscription !== false;

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    json(res, 400, { error: 'audioBase64 is required.' });
    return;
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  if (audioBuffer.length === 0) {
    json(res, 400, { error: 'audio chunk is empty.' });
    return;
  }

  const asrPrompt = useContextForTranscription ? buildAsrContextPrompt(sourceLanguage) : '';
  const transcript = (await transcribeAudio(audioBuffer, mimeType, mode, sourceLanguage, asrPrompt)).trim();

  json(res, 200, {
    createdAt: new Date().toISOString(),
    mode,
    sourceLanguage,
    usedContext: Boolean(asrPrompt),
    transcript
  });
}

async function handleTranslate(req, res) {
  if (!runtimeConfig.openaiApiKey) {
    json(res, 500, { error: 'OPENAI_API_KEY is not configured on server.' });
    return;
  }

  const body = await readJson(req);
  const transcript = String(body?.transcript || '').trim();
  const mode = body?.mode === 'high_accuracy' ? 'high_accuracy' : 'low_latency';
  const sourceLanguage = normalizeLanguageCode(body?.sourceLanguage, { allowAuto: true, fallback: 'ja' });
  const targetLanguage = normalizeLanguageCode(body?.targetLanguage, { allowAuto: false, fallback: 'en' });
  const ignoreFillers = Boolean(body?.ignoreFillers);
  const useContextForTranslation = body?.useContextForTranslation !== false;

  if (!transcript) {
    json(res, 200, {
      createdAt: new Date().toISOString(),
      mode,
      sourceLanguage,
      targetLanguage,
      ignoreFillers,
      usedContext: false,
      transcript: '',
      translation: ''
    });
    return;
  }

  const translation = (
    await translateText(transcript, {
      mode,
      sourceLanguage,
      targetLanguage,
      ignoreFillers,
      useContextForTranslation
    })
  ).trim();
  const usedContext = Boolean(useContextForTranslation && getActiveContextItems().length > 0);
  const record = {
    createdAt: new Date().toISOString(),
    mode,
    sourceLanguage,
    targetLanguage,
    ignoreFillers,
    usedContext,
    transcript,
    translation
  };

  if (translation) {
    rememberTranslationContext({
      sourceLanguage,
      targetLanguage,
      transcript,
      translation,
      createdAt: new Date().toISOString()
    });
    await appendHistory(record);
  }
  json(res, 200, record);
}

async function handleGetRuntimeConfig(res) {
  json(res, 200, buildRuntimeConfigResponse());
}

async function handleSetRuntimeConfig(req, res) {
  const body = await readJson(req);
  const nextConfig = applyRuntimeConfigPatch(body);
  runtimeConfig = nextConfig;
  queryEmbeddingCache.clear();
  contextEmbeddingsStore.model = runtimeConfig.openaiEmbeddingModel;
  await persistRuntimeConfig();

  if (!runtimeConfig.openaiApiKey) {
    console.warn('[WARN] OPENAI_API_KEY is not set. API requests will fail until you set it.');
  }

  json(res, 200, buildRuntimeConfigResponse());
}

async function handleGetContext(req, res) {
  const reqUrl = new URL(req.url || '/api/context', 'http://localhost');
  if (reqUrl.searchParams.get('view') !== 'preview') {
    json(res, 200, getContextSummary());
    return;
  }

  const startRaw = Number(reqUrl.searchParams.get('start') || 0);
  const limitRaw = Number(reqUrl.searchParams.get('limit') || CONTEXT_PREVIEW_DEFAULT_LIMIT);
  const contextId = String(reqUrl.searchParams.get('contextId') || '__active__');
  const start = Number.isFinite(startRaw) ? Math.max(0, Math.floor(startRaw)) : 0;
  const limit = Number.isFinite(limitRaw)
    ? Math.max(200, Math.min(CONTEXT_PREVIEW_MAX_LIMIT, Math.floor(limitRaw)))
    : CONTEXT_PREVIEW_DEFAULT_LIMIT;

  json(res, 200, getContextPreview(contextId, start, limit));
}

async function handleSetContext(req, res) {
  const body = await readJson(req);
  const fileName = String(body?.fileName || '').trim();
  const mimeType = String(body?.mimeType || '').trim();
  const fileBase64 = String(body?.fileBase64 || '');

  if (!fileName || !fileBase64) {
    json(res, 400, { error: 'fileName and fileBase64 are required.' });
    return;
  }

  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length === 0) {
    json(res, 400, { error: 'Context file is empty.' });
    return;
  }
  if (buffer.length > MAX_CONTEXT_FILE_BYTES) {
    json(res, 413, { error: `Context file is too large (max ${Math.round(MAX_CONTEXT_FILE_BYTES / (1024 * 1024))}MB).` });
    return;
  }

  try {
    const text = await extractContextTextFromFile({ fileName, mimeType, buffer });
    const cleaned = normalizeContextText(text);
    if (!cleaned) {
      json(res, 400, { error: 'Could not extract readable text from file.' });
      return;
    }

    const item = buildContextItem({
      id: createContextId(),
      fileName,
      mimeType: normalizeContextMimeType(fileName, mimeType),
      text: cleaned,
      loadedAt: new Date().toISOString(),
      active: true
    });
    await ensureEmbeddingsForContextItem(item).catch((error) => {
      console.warn('[WARN] Context embedding generation failed:', error?.message || error);
    });
    contextLibrary.items.unshift(item);
    await appendContextItemToStore(item);
    await persistContextEmbeddingsStore();
    json(res, 200, getContextSummary());
  } catch (error) {
    json(res, 400, { error: error?.message || 'Failed to parse context file.' });
  }
}

async function handleSetContextActive(req, res) {
  const body = await readJson(req);
  const activeIdsRaw = Array.isArray(body?.activeIds) ? body.activeIds : [];
  const activeIds = new Set(activeIdsRaw.map((x) => String(x || '').trim()).filter(Boolean));
  let changed = false;

  for (const item of contextLibrary.items) {
    const next = activeIds.has(item.id);
    if (item.active !== next) {
      item.active = next;
      changed = true;
    }
  }

  if (changed) {
    await rewriteContextStore();
  }

  json(res, 200, getContextSummary());
}

async function handleDeleteContext(req, res) {
  const reqUrl = new URL(req.url || '/api/context', 'http://localhost');
  const contextId = String(reqUrl.searchParams.get('contextId') || '').trim();

  if (contextId) {
    const before = contextLibrary.items.length;
    contextLibrary.items = contextLibrary.items.filter((item) => item.id !== contextId);
    if (contextLibrary.items.length !== before) {
      delete contextEmbeddingsStore.items[contextId];
      await rewriteContextStore();
      await persistContextEmbeddingsStore();
    }
    json(res, 200, getContextSummary());
    return;
  }

  contextLibrary = createEmptyContextLibrary();
  contextEmbeddingsStore = createEmptyContextEmbeddingsStore();
  await writeFile(CONTEXT_JSONL_FILE, '', 'utf8');
  await persistContextEmbeddingsStore();
  if (existsSync(LEGACY_CONTEXT_FILE)) {
    await unlink(LEGACY_CONTEXT_FILE).catch(() => {});
  }
  json(res, 200, getContextSummary());
}

async function handleGetGlossary(_req, res) {
  json(res, 200, getGlossarySummary());
}

async function handleAddGlossary(req, res) {
  const body = await readJson(req);
  const source = String(body?.source || '').trim();
  const target = String(body?.target || '').trim();
  const notes = String(body?.notes || '').trim();

  if (!source || !target) {
    json(res, 400, { error: 'source and target are required.' });
    return;
  }
  if (glossaryLibrary.items.length >= GLOSSARY_MAX_ITEMS) {
    json(res, 400, { error: `Glossary limit reached (${GLOSSARY_MAX_ITEMS}).` });
    return;
  }

  const item = {
    id: createGlossaryId(),
    source,
    target,
    notes,
    active: true,
    createdAt: new Date().toISOString()
  };
  glossaryLibrary.items.unshift(item);
  await persistGlossary();
  json(res, 200, getGlossarySummary());
}

async function handleToggleGlossary(req, res) {
  const body = await readJson(req);
  const id = String(body?.id || '').trim();
  const active = Boolean(body?.active);

  if (!id) {
    json(res, 400, { error: 'id is required.' });
    return;
  }

  let found = false;
  for (const item of glossaryLibrary.items) {
    if (item.id !== id) continue;
    item.active = active;
    found = true;
    break;
  }
  if (!found) {
    json(res, 404, { error: 'Glossary item not found.' });
    return;
  }
  await persistGlossary();
  json(res, 200, getGlossarySummary());
}

async function handleDeleteGlossary(req, res) {
  const reqUrl = new URL(req.url || '/api/glossary', 'http://localhost');
  const id = String(reqUrl.searchParams.get('id') || '').trim();
  if (!id) {
    glossaryLibrary = createEmptyGlossaryLibrary();
    await persistGlossary();
    json(res, 200, getGlossarySummary());
    return;
  }

  const before = glossaryLibrary.items.length;
  glossaryLibrary.items = glossaryLibrary.items.filter((item) => item.id !== id);
  if (glossaryLibrary.items.length !== before) {
    await persistGlossary();
  }
  json(res, 200, getGlossarySummary());
}

async function handleHistory(req, res, port) {
  const reqUrl = new URL(req.url || '/api/history', `http://localhost:${port}`);
  const limitRaw = Number(reqUrl.searchParams.get('limit') || 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;

  if (!existsSync(HISTORY_FILE)) {
    json(res, 200, { items: [] });
    return;
  }

  const content = await readFile(HISTORY_FILE, 'utf8');
  const lines = content
    .split('\n')
    .filter(Boolean)
    .slice(-limit);

  const items = lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  json(res, 200, { items });
}

async function serveStatic(req, res) {
  const reqPath = (req.url || '/').split('?')[0];
  let filePath = reqPath === '/' ? '/index.html' : reqPath;
  filePath = path.normalize(filePath).replace(/^\.\.(\/|\\|$)/, '');

  const abs = path.join(PUBLIC_DIR, filePath);

  if (!abs.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const fileStat = await stat(abs);
    if (fileStat.isDirectory()) {
      json(res, 404, { error: 'Not Found' });
      return;
    }

    const ext = path.extname(abs);
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    createReadStream(abs).pipe(res);
  } catch {
    json(res, 404, { error: 'Not Found' });
  }
}

async function transcribeAudio(audioBuffer, mimeType, mode, sourceLanguage, contextPrompt = '') {
  const normalizedMime = normalizeAudioMimeType(mimeType);
  const ext = mimeToExt(normalizedMime);
  const model =
    mode === 'high_accuracy' ? runtimeConfig.openaiTranscribeHighModel : runtimeConfig.openaiTranscribeLowModel;

  const form = new FormData();
  form.append('model', model);
  if (sourceLanguage && sourceLanguage !== 'auto') {
    form.append('language', sourceLanguage);
  }
  if (contextPrompt) {
    form.append('prompt', contextPrompt);
  }
  form.append('file', new Blob([audioBuffer], { type: normalizedMime }), `chunk.${ext}`);

  const response = await fetch(`${runtimeConfig.openaiBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtimeConfig.openaiApiKey}`
    },
    body: form
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Transcription failed (${response.status}, mime=${normalizedMime}, bytes=${audioBuffer.length}): ${text}`
    );
  }

  const data = await response.json();
  return data.text || '';
}

async function translateText(text, options) {
  const mode = options?.mode === 'high_accuracy' ? 'high_accuracy' : 'low_latency';
  const sourceLanguage = normalizeLanguageCode(options?.sourceLanguage, { allowAuto: true, fallback: 'ja' });
  const targetLanguage = normalizeLanguageCode(options?.targetLanguage, { allowAuto: false, fallback: 'en' });
  const ignoreFillers = Boolean(options?.ignoreFillers);
  const useContextForTranslation = options?.useContextForTranslation !== false;
  const temperature = mode === 'low_latency' ? 0.2 : 0;
  const sourceName = LANGUAGE_NAMES[sourceLanguage] || sourceLanguage;
  const targetName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const snippets = useContextForTranslation ? await getRelevantContextSnippets(text, CONTEXT_QUERY_LIMIT) : [];
  const recentPairs = getRecentTranslationContext(sourceLanguage, targetLanguage, 4);
  const glossaryItems = getActiveGlossaryItems().slice(0, 80);

  const instructions = [
    `You are a real-time subtitle translator.`,
    sourceLanguage === 'auto'
      ? `Detect the spoken source language from the user text and translate it into concise natural ${targetName} subtitles.`
      : `Translate spoken ${sourceName} into concise natural ${targetName} subtitles.`,
    sourceLanguage !== 'auto' && sourceLanguage === targetLanguage
      ? `Because source and target are both ${targetName}, keep the same language and rewrite as clean concise subtitles.`
      : 'Keep the meaning accurate while phrasing naturally for subtitles.',
    ignoreFillers
      ? 'Remove disfluencies/fillers (e.g., um, uh, er, like, あの, えーと, その) instead of translating them.'
      : 'Keep meaning faithfully, including hesitation if relevant.',
    glossaryItems.length > 0
      ? 'Apply provided glossary mappings consistently and prioritize glossary targets for exact term matches.'
      : 'No glossary mappings are provided.',
    snippets.length > 0
      ? 'Use provided reference context to preserve terminology and named entities when relevant.'
      : 'No external context is provided.',
    recentPairs.length > 0
      ? 'Use recent subtitle history to keep pronouns, tense, and terminology consistent across adjacent lines.'
      : 'No recent subtitle history is provided.',
    'Output only the translated subtitle text with no explanations.'
  ].join(' ');

  const contextBlock =
    snippets.length > 0
      ? snippets.map((snippet, index) => `Context ${index + 1}: ${snippet}`).join('\n\n')
      : '';
  const glossaryBlock =
    glossaryItems.length > 0
      ? glossaryItems.map((item) => `${item.source} => ${item.target}${item.notes ? ` (${item.notes})` : ''}`).join('\n')
      : '';
  const recentBlock =
    recentPairs.length > 0
      ? recentPairs
          .map((item, index) => `Recent ${index + 1}\nSource: ${item.transcript}\nTranslation: ${item.translation}`)
          .join('\n\n')
      : '';

  const response = await fetch(`${runtimeConfig.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtimeConfig.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: runtimeConfig.openaiTranslationModel,
      temperature,
      messages: [
        {
          role: 'system',
          content: instructions
        },
        {
          role: 'user',
          content: text
        },
        ...(glossaryBlock
          ? [
              {
                role: 'user',
                content: `Glossary mappings:\n${glossaryBlock}`
              }
            ]
          : []),
        ...(contextBlock
          ? [
              {
                role: 'user',
                content: `Reference context:\n${contextBlock}`
              }
            ]
          : []),
        ...(recentBlock
          ? [
              {
                role: 'user',
                content: `Recent subtitle history:\n${recentBlock}`
              }
            ]
          : [])
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Translation failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

function buildAsrContextPrompt(sourceLanguage) {
  const activeItems = getActiveContextItems();
  if (activeItems.length === 0) return '';

  const terms = [];
  const seen = new Set();
  for (const item of activeItems) {
    const parts = item.asrHint
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const term of parts) {
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= 90) break;
    }
    if (terms.length >= 90) break;
  }

  const glossaryTerms = getActiveGlossaryItems().map((item) => item.source);
  for (const term of glossaryTerms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= 110) break;
  }

  if (terms.length === 0) return '';
  const sourceName = LANGUAGE_NAMES[sourceLanguage] || sourceLanguage;
  return `Vocabulary hints for ${sourceName} from ${activeItems.length} context files: ${terms.join(', ')}`.slice(
    0,
    1400
  );
}

async function getRelevantContextSnippets(query, limit) {
  const activeItems = getActiveContextItems();
  if (activeItems.length === 0) return [];

  const chunks = activeItems.flatMap((item) =>
    item.indexedChunks.map((chunk) => ({
      ...chunk,
      contextId: item.id
    }))
  );
  if (chunks.length === 0) return [];

  const queryTokens = buildLatinTokenSet(query);
  const queryNgrams = buildCjkBiGramSet(query);
  const queryEmbedding = await getQueryEmbeddingVector(query).catch(() => null);
  const scored = chunks
    .map((chunk) => {
      const lexicalScore = scoreContextChunkLexical(chunk, queryTokens, queryNgrams);
      const semanticScore =
        queryEmbedding && Array.isArray(chunk.embedding) ? cosineSimilarity(queryEmbedding, chunk.embedding) : null;
      const normalizedSemantic = semanticScore == null ? 0 : Math.max(0, (semanticScore + 1) / 2);
      const score = lexicalScore * 1.8 + normalizedSemantic * 6;
      return {
        chunk,
        score
      };
    })
    .filter((item) => item.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk.text);

  if (scored.length > 0) return scored;

  const fallback = [];
  for (const item of activeItems) {
    if (!item.indexedChunks.length) continue;
    fallback.push(item.indexedChunks[0].text);
    if (fallback.length >= limit) break;
  }
  return fallback;
}

function scoreContextChunkLexical(chunk, queryTokens, queryNgrams) {
  let score = 0;
  if (queryTokens.size > 0) {
    let overlap = 0;
    for (const token of queryTokens) {
      if (chunk.tokens.has(token)) overlap += 1;
    }
    score += overlap * 3;
  }
  if (queryNgrams.size > 0) {
    let overlap = 0;
    for (const gram of queryNgrams) {
      if (chunk.cjkBigrams.has(gram)) overlap += 1;
    }
    score += overlap;
  }
  return score;
}

async function getQueryEmbeddingVector(query) {
  const normalized = String(query || '').trim();
  if (!normalized) return null;

  const cacheKey = normalized.toLowerCase().slice(0, 280);
  if (queryEmbeddingCache.has(cacheKey)) {
    const cached = queryEmbeddingCache.get(cacheKey);
    queryEmbeddingCache.delete(cacheKey);
    queryEmbeddingCache.set(cacheKey, cached);
    return cached;
  }

  const vectors = await createEmbeddings([normalized]);
  const vector = vectors[0] || null;
  if (!vector) return null;

  queryEmbeddingCache.set(cacheKey, vector);
  while (queryEmbeddingCache.size > 120) {
    const oldest = queryEmbeddingCache.keys().next().value;
    queryEmbeddingCache.delete(oldest);
  }
  return vector;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function ensureEmbeddingsForContextItem(item) {
  if (!item || !item.id || !item.textHash) return;

  const cached = contextEmbeddingsStore.items[item.id];
  const needsRefresh =
    !cached ||
    cached.textHash !== item.textHash ||
    !Array.isArray(cached.chunks) ||
    cached.chunks.length !== item.indexedChunks.length;

  if (needsRefresh) {
    const chunkTexts = item.indexedChunks.map((chunk) => chunk.text);
    const vectors = await createEmbeddings(chunkTexts);
    const chunks = item.indexedChunks.map((chunk, index) => ({
      text: chunk.text,
      embedding: Array.isArray(vectors[index]) ? vectors[index] : null
    }));
    contextEmbeddingsStore.items[item.id] = {
      textHash: item.textHash,
      chunks
    };
  }

  const stored = contextEmbeddingsStore.items[item.id];
  for (let i = 0; i < item.indexedChunks.length; i += 1) {
    const vector = stored?.chunks?.[i]?.embedding;
    item.indexedChunks[i].embedding = Array.isArray(vector) ? vector : null;
  }
}

async function loadPersistedContextEmbeddings() {
  contextEmbeddingsStore = createEmptyContextEmbeddingsStore();
  if (!existsSync(CONTEXT_EMBEDDINGS_FILE)) return;

  const raw = await readFile(CONTEXT_EMBEDDINGS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return;

  const items = parsed.items;
  if (!items || typeof items !== 'object') return;
  contextEmbeddingsStore = {
    model: String(parsed.model || runtimeConfig.openaiEmbeddingModel),
    dimensions: Number(parsed.dimensions || CONTEXT_EMBEDDING_DIMENSIONS),
    items
  };
}

async function persistContextEmbeddingsStore() {
  const payload = JSON.stringify(contextEmbeddingsStore);
  await writeFile(CONTEXT_EMBEDDINGS_FILE, payload, 'utf8');
}

async function createEmbeddings(inputs) {
  const list = Array.isArray(inputs)
    ? inputs.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  if (list.length === 0) return [];

  if (!runtimeConfig.openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured for embeddings.');
  }

  const vectors = [];
  for (let i = 0; i < list.length; i += CONTEXT_EMBEDDING_BATCH_SIZE) {
    const batch = list.slice(i, i + CONTEXT_EMBEDDING_BATCH_SIZE);
    const payload = {
      model: runtimeConfig.openaiEmbeddingModel,
      input: batch
    };
    if (runtimeConfig.openaiEmbeddingModel.startsWith('text-embedding-3')) {
      payload.dimensions = CONTEXT_EMBEDDING_DIMENSIONS;
    }
    const response = await fetch(`${runtimeConfig.openaiBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeConfig.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    const chunkVectors = Array.isArray(data?.data) ? data.data.map((row) => row.embedding || null) : [];
    vectors.push(...chunkVectors);
  }
  return vectors;
}

function createEmptyContextEmbeddingsStore() {
  return {
    model: runtimeConfig.openaiEmbeddingModel,
    dimensions: CONTEXT_EMBEDDING_DIMENSIONS,
    items: {}
  };
}

function hashText(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

async function loadPersistedGlossary() {
  glossaryLibrary = createEmptyGlossaryLibrary();
  if (!existsSync(GLOSSARY_FILE)) return;

  const raw = await readFile(GLOSSARY_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  glossaryLibrary.items = items
    .map((item) => ({
      id: String(item?.id || createGlossaryId()),
      source: String(item?.source || '').trim(),
      target: String(item?.target || '').trim(),
      notes: String(item?.notes || '').trim(),
      active: item?.active !== false,
      createdAt: String(item?.createdAt || new Date().toISOString())
    }))
    .filter((item) => item.source && item.target);
}

async function persistGlossary() {
  const payload = JSON.stringify({
    items: glossaryLibrary.items
  });
  await writeFile(GLOSSARY_FILE, payload, 'utf8');
}

function getGlossarySummary() {
  const activeCount = glossaryLibrary.items.filter((item) => item.active).length;
  return {
    totalCount: glossaryLibrary.items.length,
    activeCount,
    items: glossaryLibrary.items
  };
}

function createEmptyGlossaryLibrary() {
  return {
    items: []
  };
}

function createGlossaryId() {
  return `gls_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getActiveGlossaryItems() {
  return glossaryLibrary.items.filter((item) => item.active);
}

function rememberTranslationContext(entry) {
  if (!entry?.translation || !entry?.transcript) return;
  recentTranslationMemory.unshift({
    sourceLanguage: entry.sourceLanguage,
    targetLanguage: entry.targetLanguage,
    transcript: entry.transcript,
    translation: entry.translation,
    createdAt: entry.createdAt || new Date().toISOString()
  });
  while (recentTranslationMemory.length > RECENT_TRANSLATION_MAX) {
    recentTranslationMemory.pop();
  }
}

function getRecentTranslationContext(sourceLanguage, targetLanguage, limit = 4) {
  return recentTranslationMemory
    .filter((item) => item.sourceLanguage === sourceLanguage && item.targetLanguage === targetLanguage)
    .slice(0, limit);
}

async function loadPersistedContext() {
  contextLibrary = createEmptyContextLibrary();

  if (existsSync(CONTEXT_JSONL_FILE)) {
    const raw = await readFile(CONTEXT_JSONL_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const text = normalizeContextText(parsed?.text || '');
      if (!text) continue;

      const item = buildContextItem({
        id: String(parsed?.id || createContextId()),
        fileName: String(parsed?.fileName || 'context.txt'),
        mimeType: normalizeContextMimeType(String(parsed?.fileName || ''), String(parsed?.mimeType || 'text/plain')),
        text,
        loadedAt: String(parsed?.loadedAt || new Date().toISOString()),
        active: parsed?.active !== false
      });
      contextLibrary.items.push(item);
    }
    contextLibrary.items.reverse();
  } else if (existsSync(LEGACY_CONTEXT_FILE)) {
    const raw = await readFile(LEGACY_CONTEXT_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const text = normalizeContextText(parsed?.text || '');
    if (text) {
      const migrated = buildContextItem({
        id: createContextId(),
        fileName: String(parsed?.fileName || 'context.txt'),
        mimeType: normalizeContextMimeType(String(parsed?.fileName || ''), String(parsed?.mimeType || 'text/plain')),
        text,
        loadedAt: String(parsed?.loadedAt || new Date().toISOString()),
        active: true
      });
      contextLibrary.items = [migrated];
      await rewriteContextStore();
    }
    await unlink(LEGACY_CONTEXT_FILE).catch(() => {});
  }

  await loadPersistedContextEmbeddings().catch(() => {
    contextEmbeddingsStore = createEmptyContextEmbeddingsStore();
  });

  for (const item of contextLibrary.items) {
    const stored = contextEmbeddingsStore.items[item.id];
    const sameHash = stored?.textHash && stored.textHash === item.textHash;
    if (!sameHash) {
      await ensureEmbeddingsForContextItem(item).catch((error) => {
        console.warn('[WARN] Failed to rebuild embeddings:', error?.message || error);
      });
      continue;
    }

    for (let i = 0; i < item.indexedChunks.length; i += 1) {
      const vector = stored?.chunks?.[i]?.embedding;
      item.indexedChunks[i].embedding = Array.isArray(vector) ? vector : null;
    }
  }

  const validIds = new Set(contextLibrary.items.map((item) => item.id));
  for (const key of Object.keys(contextEmbeddingsStore.items)) {
    if (!validIds.has(key)) {
      delete contextEmbeddingsStore.items[key];
    }
  }

  await persistContextEmbeddingsStore();
}

async function appendContextItemToStore(item) {
  const row = {
    id: item.id,
    fileName: item.fileName,
    mimeType: item.mimeType,
    loadedAt: item.loadedAt,
    active: item.active,
    text: item.text
  };
  await appendFile(CONTEXT_JSONL_FILE, `${JSON.stringify(row)}\n`, 'utf8');
}

async function rewriteContextStore() {
  if (!contextLibrary.items.length) {
    await writeFile(CONTEXT_JSONL_FILE, '', 'utf8');
    return;
  }

  const lines = contextLibrary.items.map((item) =>
    JSON.stringify({
      id: item.id,
      fileName: item.fileName,
      mimeType: item.mimeType,
      loadedAt: item.loadedAt,
      active: item.active,
      text: item.text
    })
  );
  await writeFile(CONTEXT_JSONL_FILE, `${lines.join('\n')}\n`, 'utf8');
}

function getContextSummary() {
  const items = contextLibrary.items.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    mimeType: item.mimeType,
    loadedAt: item.loadedAt,
    charCount: item.text.length,
    chunkCount: item.indexedChunks.length,
    active: item.active,
    embeddingReady: item.indexedChunks.length > 0 && item.indexedChunks.every((chunk) => Array.isArray(chunk.embedding))
  }));
  const activeItems = getActiveContextItems();
  const activeCharCount = activeItems.reduce((sum, item) => sum + item.text.length, 0);
  const activeChunkCount = activeItems.reduce((sum, item) => sum + item.indexedChunks.length, 0);
  const totalCharCount = contextLibrary.items.reduce((sum, item) => sum + item.text.length, 0);
  const latestLoadedAt =
    contextLibrary.items
      .map((item) => item.loadedAt)
      .sort()
      .at(-1) || '';

  const primaryFileName =
    activeItems.length === 1
      ? activeItems[0].fileName
      : activeItems.length > 1
        ? `${activeItems.length} context files`
        : '';

  return {
    loaded: activeItems.length > 0,
    fileName: primaryFileName,
    mimeType: activeItems.length === 1 ? activeItems[0].mimeType : '',
    loadedAt: latestLoadedAt,
    charCount: activeCharCount,
    chunkCount: activeChunkCount,
    totalCount: contextLibrary.items.length,
    activeCount: activeItems.length,
    totalCharCount,
    activeIds: activeItems.map((item) => item.id),
    items
  };
}

function getContextPreview(contextId, start, limit) {
  const source = getPreviewSource(contextId);
  if (!source.text) {
    return {
      loaded: false,
      contextId: source.contextId,
      contextLabel: source.label,
      start: 0,
      end: 0,
      totalChars: 0,
      preview: ''
    };
  }

  const total = source.text.length;
  const safeStart = Math.max(0, Math.min(start, Math.max(0, total - 1)));
  const safeLimit = Math.max(1, Math.min(CONTEXT_PREVIEW_MAX_LIMIT, limit));
  const end = Math.min(total, safeStart + safeLimit);

  return {
    ...getContextSummary(),
    contextId: source.contextId,
    contextLabel: source.label,
    start: safeStart,
    end,
    totalChars: total,
    hasMore: end < total,
    preview: source.text.slice(safeStart, end)
  };
}

function getPreviewSource(contextId) {
  const key = String(contextId || '__active__');
  if (key === '__active__') {
    const activeItems = getActiveContextItems();
    if (!activeItems.length) {
      return { contextId: '__active__', label: 'Active Contexts', text: '' };
    }

    const text = activeItems
      .map((item) => `### ${item.fileName}\n${item.text}`)
      .join('\n\n');
    return {
      contextId: '__active__',
      label: `Active Contexts (${activeItems.length})`,
      text
    };
  }

  const item = contextLibrary.items.find((x) => x.id === key);
  if (!item) {
    return { contextId: key, label: 'Unknown', text: '' };
  }
  return {
    contextId: item.id,
    label: item.fileName,
    text: item.text
  };
}

function getActiveContextItems() {
  return contextLibrary.items.filter((item) => item.active);
}

function createEmptyContextLibrary() {
  return {
    items: []
  };
}

function buildContextItem({ id, fileName, mimeType, text, loadedAt, active }) {
  const chunks = splitIntoChunks(text, CONTEXT_CHUNK_CHARS, CONTEXT_CHUNK_OVERLAP);
  const indexedChunks = chunks.map((chunk) => ({
    text: chunk,
    tokens: buildLatinTokenSet(chunk),
    cjkBigrams: buildCjkBiGramSet(chunk),
    embedding: null
  }));
  return {
    id,
    fileName,
    mimeType,
    loadedAt,
    active: Boolean(active),
    text,
    textHash: hashText(text),
    asrHint: buildAsrHint(text),
    indexedChunks
  };
}

function createContextId() {
  return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildAsrHint(text) {
  const freq = new Map();
  const regex = /[A-Za-z][A-Za-z0-9+_.-]{2,}|[\u30A0-\u30FF]{2,}|[\u4E00-\u9FFF]{2,}/g;
  const stop = new Set(['this', 'that', 'with', 'from', 'have', 'will', 'into', 'about', 'then', 'when', 'where']);
  const matches = text.match(regex) || [];
  for (const raw of matches) {
    const term = raw.trim();
    const lower = term.toLowerCase();
    if (stop.has(lower)) continue;
    freq.set(term, (freq.get(term) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([term]) => term)
    .join(', ');
}

function splitIntoChunks(text, size, overlap) {
  const chunks = [];
  const cleaned = normalizeContextText(text);
  if (!cleaned) return chunks;

  let pos = 0;
  while (pos < cleaned.length) {
    const end = Math.min(cleaned.length, pos + size);
    chunks.push(cleaned.slice(pos, end));
    if (end >= cleaned.length) break;
    pos = Math.max(0, end - overlap);
  }
  return chunks;
}

function buildLatinTokenSet(text) {
  const set = new Set();
  const matches = String(text || '').toLowerCase().match(/[a-z][a-z0-9+_.-]{1,}/g) || [];
  for (const token of matches) {
    if (token.length >= 2) set.add(token);
  }
  return set;
}

function buildCjkBiGramSet(text) {
  const normalized = String(text || '').replace(/\s+/g, '');
  const set = new Set();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const pair = normalized.slice(i, i + 2);
    if (/[\u3040-\u30ff\u4e00-\u9fff]/i.test(pair)) {
      set.add(pair);
    }
  }
  return set;
}

function normalizeContextText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function extractContextTextFromFile(file) {
  const fileName = String(file.fileName || 'context.txt');
  const mimeType = normalizeContextMimeType(fileName, file.mimeType);
  const ext = path.extname(fileName).toLowerCase();
  const buffer = file.buffer;

  if (mimeType.startsWith('text/') || ext === '.txt' || ext === '.md' || ext === '.rtf') {
    return buffer.toString('utf8');
  }
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return extractTextFromPdf(buffer);
  }
  if (ext === '.docx' || mimeType === CONTEXT_MIME_BY_EXT['.docx']) {
    return extractTextFromDocx(buffer);
  }
  if (ext === '.pptx' || mimeType === CONTEXT_MIME_BY_EXT['.pptx']) {
    return extractTextFromPptx(buffer);
  }

  throw new Error('Unsupported file type. Use PDF, DOCX, PPTX, TXT, or MD.');
}

async function extractTextFromPdf(buffer) {
  try {
    const mod = await import('pdf-parse');
    const pdfParse = mod.default || mod;
    const data = await pdfParse(buffer);
    return data?.text || '';
  } catch (error) {
    if (String(error?.message || '').includes('Cannot find package')) {
      throw new Error('Missing dependency: pdf-parse. Run npm install or pnpm install.');
    }
    throw error;
  }
}

async function extractTextFromDocx(buffer) {
  try {
    const mod = await import('mammoth');
    const mammoth = mod.default || mod;
    const result = await mammoth.extractRawText({ buffer });
    return result?.value || '';
  } catch (error) {
    if (String(error?.message || '').includes('Cannot find package')) {
      throw new Error('Missing dependency: mammoth. Run npm install or pnpm install.');
    }
    throw error;
  }
}

async function extractTextFromPptx(buffer) {
  try {
    const mod = await import('jszip');
    const JSZip = mod.default || mod;
    const zip = await JSZip.loadAsync(buffer);
    const slidePaths = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => extractSlideNumber(a) - extractSlideNumber(b));

    if (slidePaths.length === 0) return '';

    const texts = [];
    for (const slidePath of slidePaths) {
      const file = zip.file(slidePath);
      if (!file) continue;
      const xml = await file.async('string');
      texts.push(xmlToText(xml));
    }
    return texts.join('\n\n');
  } catch (error) {
    if (String(error?.message || '').includes('Cannot find package')) {
      throw new Error('Missing dependency: jszip. Run npm install or pnpm install.');
    }
    throw error;
  }
}

function extractSlideNumber(name) {
  const m = name.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

function xmlToText(xml) {
  return decodeXmlEntities(
    String(xml || '')
      .replace(/<a:br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeContextMimeType(fileName, mimeType) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (CONTEXT_MIME_BY_EXT[ext]) return CONTEXT_MIME_BY_EXT[ext];
  if (mimeType) return String(mimeType).toLowerCase();
  return 'application/octet-stream';
}

function createRuntimeConfigFromEnv() {
  return {
    openaiApiKey: normalizeApiKey(process.env.OPENAI_API_KEY),
    openaiBaseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL, DEFAULT_RUNTIME_CONFIG.openaiBaseUrl),
    openaiTranslationModel: normalizeModelName(
      process.env.OPENAI_TRANSLATION_MODEL,
      DEFAULT_RUNTIME_CONFIG.openaiTranslationModel
    ),
    openaiEmbeddingModel: normalizeModelName(
      process.env.OPENAI_EMBEDDING_MODEL,
      DEFAULT_RUNTIME_CONFIG.openaiEmbeddingModel
    ),
    openaiTranscribeLowModel: normalizeModelName(
      process.env.OPENAI_TRANSCRIBE_LOW_MODEL,
      DEFAULT_RUNTIME_CONFIG.openaiTranscribeLowModel
    ),
    openaiTranscribeHighModel: normalizeModelName(
      process.env.OPENAI_TRANSCRIBE_HIGH_MODEL,
      DEFAULT_RUNTIME_CONFIG.openaiTranscribeHighModel
    )
  };
}

async function loadPersistedRuntimeConfig() {
  if (!existsSync(RUNTIME_CONFIG_FILE)) return;

  const raw = await readFile(RUNTIME_CONFIG_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  runtimeConfig = applyRuntimeConfigPatch(parsed);
}

async function persistRuntimeConfig() {
  const payload = JSON.stringify(
    {
      openaiApiKey: runtimeConfig.openaiApiKey,
      openaiBaseUrl: runtimeConfig.openaiBaseUrl,
      openaiTranslationModel: runtimeConfig.openaiTranslationModel,
      openaiEmbeddingModel: runtimeConfig.openaiEmbeddingModel,
      openaiTranscribeLowModel: runtimeConfig.openaiTranscribeLowModel,
      openaiTranscribeHighModel: runtimeConfig.openaiTranscribeHighModel
    },
    null,
    2
  );
  await writeFile(RUNTIME_CONFIG_FILE, payload, 'utf8');
}

function applyRuntimeConfigPatch(patch) {
  const value = patch && typeof patch === 'object' ? patch : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(value, key);

  return {
    openaiApiKey: has('openaiApiKey') ? normalizeApiKey(value.openaiApiKey) : runtimeConfig.openaiApiKey,
    openaiBaseUrl: has('openaiBaseUrl')
      ? normalizeBaseUrl(value.openaiBaseUrl, DEFAULT_RUNTIME_CONFIG.openaiBaseUrl)
      : runtimeConfig.openaiBaseUrl,
    openaiTranslationModel: has('openaiTranslationModel')
      ? normalizeModelName(value.openaiTranslationModel, DEFAULT_RUNTIME_CONFIG.openaiTranslationModel)
      : runtimeConfig.openaiTranslationModel,
    openaiEmbeddingModel: has('openaiEmbeddingModel')
      ? normalizeModelName(value.openaiEmbeddingModel, DEFAULT_RUNTIME_CONFIG.openaiEmbeddingModel)
      : runtimeConfig.openaiEmbeddingModel,
    openaiTranscribeLowModel: has('openaiTranscribeLowModel')
      ? normalizeModelName(value.openaiTranscribeLowModel, DEFAULT_RUNTIME_CONFIG.openaiTranscribeLowModel)
      : runtimeConfig.openaiTranscribeLowModel,
    openaiTranscribeHighModel: has('openaiTranscribeHighModel')
      ? normalizeModelName(value.openaiTranscribeHighModel, DEFAULT_RUNTIME_CONFIG.openaiTranscribeHighModel)
      : runtimeConfig.openaiTranscribeHighModel
  };
}

function buildRuntimeConfigResponse() {
  return {
    hasOpenaiApiKey: Boolean(runtimeConfig.openaiApiKey),
    openaiApiKeyMasked: maskSecret(runtimeConfig.openaiApiKey),
    openaiBaseUrl: runtimeConfig.openaiBaseUrl,
    openaiTranslationModel: runtimeConfig.openaiTranslationModel,
    openaiEmbeddingModel: runtimeConfig.openaiEmbeddingModel,
    openaiTranscribeLowModel: runtimeConfig.openaiTranscribeLowModel,
    openaiTranscribeHighModel: runtimeConfig.openaiTranscribeHighModel
  };
}

function normalizeApiKey(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.replace(/\/+$/g, '');
}

function normalizeModelName(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function maskSecret(secret) {
  const text = String(secret || '').trim();
  if (!text) return '';
  if (text.length <= 8) {
    return `${text.slice(0, 2)}...${text.slice(-1)}`;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function appendHistory(record) {
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(HISTORY_FILE, line, 'utf8');
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function normalizeAudioMimeType(mimeType) {
  const lower = String(mimeType || 'audio/webm').toLowerCase();
  const base = lower.split(';')[0].trim();
  return base || 'audio/webm';
}

function mimeToExt(mimeType) {
  if (MIME_EXT[mimeType]) return MIME_EXT[mimeType];
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mp4')) return 'mp4';
  return 'webm';
}

function normalizeLanguageCode(value, options = {}) {
  const allowAuto = Boolean(options.allowAuto);
  const fallback = allowAuto ? 'ja' : 'en';
  const code = String(value || '').toLowerCase().trim();

  if (!code) return options.fallback || fallback;
  if (!SUPPORTED_LANGUAGE_CODES.has(code)) return options.fallback || fallback;
  if (!allowAuto && code === 'auto') return options.fallback || fallback;
  return code;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}
