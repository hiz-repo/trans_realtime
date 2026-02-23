const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sourceLanguageSelect = document.getElementById('sourceLanguage');
const targetLanguageSelect = document.getElementById('targetLanguage');
const modeSelect = document.getElementById('mode');
const statusEl = document.getElementById('status');
const contextFileInput = document.getElementById('contextFile');
const uploadContextBtn = document.getElementById('uploadContextBtn');
const clearContextBtn = document.getElementById('clearContextBtn');
const contextStatusEl = document.getElementById('contextStatus');
const contextListEl = document.getElementById('contextList');
const contextPreviewTargetEl = document.getElementById('contextPreviewTarget');
const viewContextBtn = document.getElementById('viewContextBtn');
const prevContextBtn = document.getElementById('prevContextBtn');
const nextContextBtn = document.getElementById('nextContextBtn');
const contextPreviewMetaEl = document.getElementById('contextPreviewMeta');
const contextPreviewEl = document.getElementById('contextPreview');
const glossarySourceEl = document.getElementById('glossarySource');
const glossaryTargetEl = document.getElementById('glossaryTarget');
const glossaryNotesEl = document.getElementById('glossaryNotes');
const addGlossaryBtn = document.getElementById('addGlossaryBtn');
const glossaryStatusEl = document.getElementById('glossaryStatus');
const glossaryListEl = document.getElementById('glossaryList');
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
const openaiTranslationModelInput = document.getElementById('openaiTranslationModel');
const openaiEmbeddingModelInput = document.getElementById('openaiEmbeddingModel');
const openaiTranscribeLowModelInput = document.getElementById('openaiTranscribeLowModel');
const openaiTranscribeHighModelInput = document.getElementById('openaiTranscribeHighModel');
const saveApiConfigBtn = document.getElementById('saveApiConfigBtn');
const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');
const apiConfigStatusEl = document.getElementById('apiConfigStatus');
const micStatusTextEl = document.getElementById('micStatusText');
const micLevelBarEl = document.getElementById('micLevelBar');
const overlayEl = document.getElementById('subtitleOverlay');
const historyListEl = document.getElementById('historyList');
const overlayToggleWrap = document.getElementById('overlayToggleWrap');
const overlayToggle = document.getElementById('overlayToggle');
const noiseThresholdValueEl = document.getElementById('noiseThresholdValue');
const overlayBgOpacityValueEl = document.getElementById('overlayBgOpacityValue');
const isElectron = Boolean(window.electronAPI?.isElectron);

const SETTINGS_STORAGE_KEY = 'realtime_settings_v3';
const LEGACY_SETTINGS_STORAGE_KEY = 'realtime_settings_v2';
const CONTEXT_PREVIEW_ACTIVE_TARGET = '__active__';
const MAX_OVERLAY_LINES = 3;
const MAX_HISTORY_ITEMS = 200;
const CONTEXT_PREVIEW_PAGE_CHARS = 3200;
const SENTENCE_END_RE = /[。！？.!?]\s*$/;
const CLAUSE_END_RE = /[。！？.!?、，,;；:：]\s*$/;
const TRAILING_CONNECTOR_RE =
  /(?:\b(?:and|or|but|so|to|of|for|with|by|because|if|when|while|that|which|whose|where|after|before|about)\b|(?:ので|けど|けれど|から|のに|ために|として|など|とか))\s*$/i;
const SUPPORTED_SOURCE_LANGUAGES = [
  { code: 'auto', label: '自動検出' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' }
];
const SUPPORTED_TARGET_LANGUAGES = SUPPORTED_SOURCE_LANGUAGES.filter((x) => x.code !== 'auto');

const settingInputIds = {
  sourceLanguage: 'sourceLanguage',
  targetLanguage: 'targetLanguage',
  segmentMsLow: 'segLowMs',
  segmentMsHigh: 'segHighMs',
  flushCharsLow: 'flushCharsLow',
  flushCharsHigh: 'flushCharsHigh',
  flushHoldLowMs: 'flushHoldLowMs',
  flushHoldHighMs: 'flushHoldHighMs',
  noiseThreshold: 'noiseThreshold',
  noiseMinVoiceMs: 'noiseMinVoiceMs',
  ignoreFillers: 'ignoreFillers',
  useContextTranscription: 'useContextTranscription',
  useContextTranslation: 'useContextTranslation',
  overlayFontSize: 'overlayFontSize',
  overlayBottom: 'overlayBottom',
  overlayTextColor: 'overlayTextColor',
  overlayBgColor: 'overlayBgColor',
  overlayBgOpacity: 'overlayBgOpacity',
  overlayRadius: 'overlayRadius'
};

const DEFAULT_TUNING_SETTINGS = Object.freeze({
  segmentMsLow: 1800,
  segmentMsHigh: 5200,
  flushCharsLow: 38,
  flushCharsHigh: 88,
  flushHoldLowMs: 5400,
  flushHoldHighMs: 12000
});

const settings = {
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  segmentMsLow: DEFAULT_TUNING_SETTINGS.segmentMsLow,
  segmentMsHigh: DEFAULT_TUNING_SETTINGS.segmentMsHigh,
  flushCharsLow: DEFAULT_TUNING_SETTINGS.flushCharsLow,
  flushCharsHigh: DEFAULT_TUNING_SETTINGS.flushCharsHigh,
  flushHoldLowMs: DEFAULT_TUNING_SETTINGS.flushHoldLowMs,
  flushHoldHighMs: DEFAULT_TUNING_SETTINGS.flushHoldHighMs,
  noiseThreshold: 0.016,
  noiseMinVoiceMs: 180,
  ignoreFillers: true,
  useContextTranscription: true,
  useContextTranslation: true,
  overlayFontSize: 32,
  overlayBottom: 14,
  overlayTextColor: '#ffffff',
  overlayBgColor: '#000000',
  overlayBgOpacity: 0.78,
  overlayRadius: 10
};

let mediaStream = null;
let mediaRecorder = null;
let processingChain = Promise.resolve();
let isRecording = false;
let isStopping = false;
let segmentTimer = null;
let activeMode = 'high_accuracy';
let activeMimeType = '';
let segmentChunks = [];
let pendingTranscript = '';
let pendingSinceMs = 0;
let gateFeedbackUntilMs = 0;
let contextMeta = null;
let contextItems = [];
let contextPreviewTarget = CONTEXT_PREVIEW_ACTIVE_TARGET;
let contextPreviewStart = 0;
let contextPreviewEnd = 0;
let contextPreviewTotal = 0;
let isContextPreviewOpen = false;
let glossaryItems = [];
let runtimeConfigMeta = null;

let audioContext = null;
let analyserNode = null;
let analyserData = null;
let meterRafId = 0;
let lastMeterTickMs = 0;
let currentRms = 0;
let lastSpeechDetectedAt = 0;
let segmentStats = {
  voicedMs: 0,
  totalMs: 0,
  peakRms: 0
};

const overlayLines = [];

startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

initSettings();
initOverlayMode();
bindContextActions();
bindGlossaryActions();
bindRuntimeConfigActions();
void loadContextState();
void loadGlossary();
void loadHistory();
void loadRuntimeConfig();

async function startRecording() {
  if (isRecording) return;

  try {
    setStatus('マイク権限を確認中...');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    await ensureAnalyzer(mediaStream);

    activeMode = currentMode();
    activeMimeType = pickSupportedMimeType();
    if (!activeMimeType) {
      throw new Error('このブラウザの録音形式に対応していません。Chrome/Edge を推奨します。');
    }

    pendingTranscript = '';
    pendingSinceMs = 0;
    resetSegmentStats();
    gateFeedbackUntilMs = 0;
    lastSpeechDetectedAt = Date.now();

    if (isElectron) {
      window.electronAPI.clearSubtitles();
    }

    isRecording = true;
    isStopping = false;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    modeSelect.disabled = true;
    setStatus(`録音中 (${labelMode(activeMode)})`);
    setMicState('listening', '入力待機中');
    startSegmentRecorder();
  } catch (error) {
    console.error(error);
    setStatus(`開始失敗: ${error.message}`);
    isRecording = false;
    isStopping = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    modeSelect.disabled = false;
    cleanupMedia();
    setMicState('idle', '待機中');
  }
}

function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  isStopping = true;
  clearSegmentTimer();
  setStatus('停止中...');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    return;
  }

  enqueueProcessing(async () => {
    await flushPendingTranscript(activeMode, true);
  }).finally(() => {
    if (isStopping) {
      finalizeStop();
    }
  });
}

function cleanupMedia() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
  mediaStream = null;
  mediaRecorder = null;
  activeMimeType = '';
  segmentChunks = [];

  if (meterRafId) {
    cancelAnimationFrame(meterRafId);
    meterRafId = 0;
  }

  if (audioContext) {
    void audioContext.close().catch(() => {});
  }
  audioContext = null;
  analyserNode = null;
  analyserData = null;
  lastMeterTickMs = 0;
  currentRms = 0;
  updateMicMeter(0);
}

function finalizeStop() {
  cleanupMedia();
  startBtn.disabled = false;
  stopBtn.disabled = true;
  modeSelect.disabled = false;
  isStopping = false;
  setStatus('停止しました');
  setMicState('idle', '待機中');
}

function startSegmentRecorder() {
  if (!isRecording || !mediaStream) return;

  segmentChunks = [];
  resetSegmentStats();

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: activeMimeType });
  const currentMimeType = mediaRecorder.mimeType || activeMimeType;

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      segmentChunks.push(event.data);
    }
  };

  mediaRecorder.onerror = (event) => {
    const message = event?.error?.message || 'MediaRecorder error';
    console.error('[recorder]', message);
    setStatus(`録音エラー: ${message}`);
  };

  mediaRecorder.onstop = () => {
    const blob =
      segmentChunks.length <= 1
        ? segmentChunks[0]
        : new Blob(segmentChunks, { type: currentMimeType || 'audio/webm' });

    const shouldSend = blob && blob.size > 0 && shouldSendSegment();

    if (shouldSend) {
      enqueueProcessing(async () => {
        await processChunk(blob, currentMimeType, activeMode);
      });
    } else if (blob && blob.size > 0) {
      gateFeedbackUntilMs = Date.now() + 900;
      setStatus('ノイズゲートで小さい入力を除外しました');
    }

    segmentChunks = [];

    if (isRecording) {
      startSegmentRecorder();
      return;
    }

    if (isStopping) {
      enqueueProcessing(async () => {
        await flushPendingTranscript(activeMode, true);
      }).finally(() => {
        if (isStopping) {
          finalizeStop();
        }
      });
    }
  };

  mediaRecorder.start();
  segmentTimer = window.setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }, segmentDurationMs(activeMode));
}

function shouldSendSegment() {
  const threshold = settings.noiseThreshold;
  const minVoiceMs = settings.noiseMinVoiceMs;
  if (segmentStats.totalMs < 40) return true;
  return segmentStats.peakRms >= threshold && segmentStats.voicedMs >= minVoiceMs;
}

function clearSegmentTimer() {
  if (segmentTimer) {
    window.clearTimeout(segmentTimer);
    segmentTimer = null;
  }
}

function segmentDurationMs(mode) {
  return mode === 'high_accuracy' ? settings.segmentMsHigh : settings.segmentMsLow;
}

async function processChunk(blob, mimeType, mode) {
  setStatus(`文字起こし中... (${labelMode(mode)})`);
  const audioBase64 = await blobToBase64(blob);

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audioBase64,
      mimeType,
      mode,
      sourceLanguage: settings.sourceLanguage,
      useContextForTranscription: settings.useContextTranscription
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const transcriptPiece = normalizeTranscriptPiece(data.transcript);
  if (transcriptPiece) {
    appendPendingTranscript(transcriptPiece);
  }
  await maybeFlushPendingTranscript(mode, transcriptPiece);

  if (isRecording) {
    setStatus(`録音中 (${labelMode(mode)})`);
  }
}

function enqueueProcessing(task) {
  processingChain = processingChain.then(task).catch((error) => {
    console.error(error);
    setStatus(`エラー: ${error.message}`);
  });
  return processingChain;
}

async function maybeFlushPendingTranscript(mode, latestPiece) {
  if (!shouldFlushTranscript(mode, latestPiece, false)) return;
  await flushPendingTranscript(mode, false);
}

async function flushPendingTranscript(mode, force) {
  if (!shouldFlushTranscript(mode, '', force)) return;

  const transcript = pendingTranscript.trim();
  if (!transcript) return;

  pendingTranscript = '';
  pendingSinceMs = 0;
  setStatus(`翻訳中... (${labelMode(mode)})`);

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transcript,
        mode,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        ignoreFillers: settings.ignoreFillers,
        useContextForTranslation: settings.useContextTranslation
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (data.translation) {
      publishSubtitle(data.translation);
      prependHistoryItem(data);
    }
  } catch (error) {
    pendingTranscript = pendingTranscript
      ? `${transcript}${needsSpaceBetween(transcript, pendingTranscript) ? ' ' : ''}${pendingTranscript}`
      : transcript;
    if (!pendingSinceMs) {
      pendingSinceMs = Date.now();
    }
    throw error;
  }
}

function appendPendingTranscript(piece) {
  if (!piece) return;

  if (!pendingTranscript) {
    pendingTranscript = piece;
    pendingSinceMs = Date.now();
    return;
  }

  pendingTranscript = `${pendingTranscript}${needsSpaceBetween(pendingTranscript, piece) ? ' ' : ''}${piece}`;
}

function shouldFlushTranscript(mode, latestPiece, force) {
  const text = pendingTranscript.trim();
  if (!text) return false;
  if (force) return true;

  const minChars = mode === 'high_accuracy' ? settings.flushCharsHigh : settings.flushCharsLow;
  const maxHoldMs = mode === 'high_accuracy' ? settings.flushHoldHighMs : settings.flushHoldLowMs;
  const silenceMs = lastSpeechDetectedAt > 0 ? Date.now() - lastSpeechDetectedAt : 0;
  const sentenceSilenceMs = mode === 'high_accuracy' ? 360 : 260;
  const clauseSilenceMs = mode === 'high_accuracy' ? 820 : 620;
  const longSilenceFlushMs = mode === 'high_accuracy' ? 1800 : 1050;
  const latestText = (latestPiece || text).trim();
  const sentenceEnded = SENTENCE_END_RE.test(latestText) || SENTENCE_END_RE.test(text);
  const clauseEnded = CLAUSE_END_RE.test(latestText) || CLAUSE_END_RE.test(text);
  const endsWithConnector = TRAILING_CONNECTOR_RE.test(text);

  if (sentenceEnded && silenceMs >= sentenceSilenceMs) {
    return true;
  }
  if (sentenceEnded && text.length >= Math.round(minChars * 0.72)) {
    return true;
  }

  if (text.length >= minChars) {
    const hardLimit = Math.round(minChars * (mode === 'high_accuracy' ? 2.15 : 1.9));

    if (text.length >= hardLimit) return true;
    if (!endsWithConnector && clauseEnded && silenceMs >= clauseSilenceMs) {
      return true;
    }
    if (!endsWithConnector && silenceMs >= longSilenceFlushMs) {
      return true;
    }
  }
  if (pendingSinceMs > 0 && Date.now() - pendingSinceMs >= maxHoldMs) {
    return true;
  }

  return false;
}

function needsSpaceBetween(prev, next) {
  return /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next);
}

function normalizeTranscriptPiece(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function bindContextActions() {
  uploadContextBtn.addEventListener('click', async () => {
    await uploadSelectedContextFile();
  });

  clearContextBtn.addEventListener('click', async () => {
    await clearAllContexts();
  });

  viewContextBtn.addEventListener('click', async () => {
    if (isContextPreviewOpen) {
      setContextPreviewOpen(false, { reset: true });
      return;
    }
    setContextPreviewOpen(true, { reset: true });
    await loadContextPreview(true);
  });

  prevContextBtn.addEventListener('click', async () => {
    if (contextPreviewStart <= 0) return;
    contextPreviewStart = Math.max(0, contextPreviewStart - CONTEXT_PREVIEW_PAGE_CHARS);
    await loadContextPreview(false);
  });

  nextContextBtn.addEventListener('click', async () => {
    if (contextPreviewEnd >= contextPreviewTotal) return;
    contextPreviewStart = contextPreviewEnd;
    await loadContextPreview(false);
  });

  contextPreviewTargetEl.addEventListener('change', async () => {
    contextPreviewTarget = contextPreviewTargetEl.value || CONTEXT_PREVIEW_ACTIVE_TARGET;
    if (isContextPreviewOpen) {
      await loadContextPreview(true);
    }
  });

  setContextPreviewOpen(false, { reset: true });
  updateContextPreviewButtons();
}

async function loadContextState() {
  try {
    const response = await fetch('/api/context');
    if (!response.ok) {
      throw new Error(`context API error ${response.status}`);
    }
    const data = await response.json();
    contextMeta = data || null;
    contextItems = Array.isArray(data?.items) ? data.items : [];
    syncContextPreviewTargetOptions();
    renderContextStatus();
    renderContextList();

    if (contextItems.length > 0 && isContextPreviewOpen) {
      await loadContextPreview(true);
    } else {
      renderContextPreviewEmpty(contextItems.length > 0 ? '表示するには「内容を表示」を押してください' : '保存済みContextなし');
    }
  } catch (error) {
    console.error(error);
    contextMeta = null;
    contextItems = [];
    contextPreviewTarget = CONTEXT_PREVIEW_ACTIVE_TARGET;
    syncContextPreviewTargetOptions();
    contextStatusEl.textContent = `コンテキスト状態取得に失敗: ${error.message}`;
    renderContextPreviewEmpty('読み込み失敗');
    contextListEl.innerHTML = '';
  }
}

async function uploadSelectedContextFile() {
  const file = contextFileInput.files?.[0];
  if (!file) {
    contextStatusEl.textContent = '先にファイルを選択してください。';
    return;
  }

  uploadContextBtn.disabled = true;
  clearContextBtn.disabled = true;
  contextStatusEl.textContent = `読み込み中: ${file.name}`;

  try {
    const fileBase64 = await fileToBase64(file);
    const response = await fetch('/api/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`context upload failed ${response.status}: ${body}`);
    }

    const data = await response.json();
    contextMeta = data || null;
    contextItems = Array.isArray(data?.items) ? data.items : [];
    const latest = contextItems[0];
    if (latest?.id) {
      contextPreviewTarget = latest.id;
    }
    syncContextPreviewTargetOptions();
    renderContextStatus();
    renderContextList();
    if (isContextPreviewOpen) {
      await loadContextPreview(true);
    } else {
      renderContextPreviewEmpty('表示するには「内容を表示」を押してください');
    }
    setStatus('Context fileを追加しました');
  } catch (error) {
    console.error(error);
    contextStatusEl.textContent = `読み込み失敗: ${error.message}`;
  } finally {
    uploadContextBtn.disabled = false;
    clearContextBtn.disabled = false;
  }
}

async function clearAllContexts() {
  uploadContextBtn.disabled = true;
  clearContextBtn.disabled = true;

  try {
    const response = await fetch('/api/context', {
      method: 'DELETE'
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`context clear failed ${response.status}: ${body}`);
    }

    contextMeta = await response.json();
    contextItems = [];
    contextFileInput.value = '';
    contextPreviewTarget = CONTEXT_PREVIEW_ACTIVE_TARGET;
    syncContextPreviewTargetOptions();
    renderContextList();
    renderContextStatus();
    setContextPreviewOpen(false, { reset: true });
    renderContextPreviewEmpty('保存済みContextなし');
    setStatus('保存済みContextを全削除しました');
  } catch (error) {
    console.error(error);
    contextStatusEl.textContent = `クリア失敗: ${error.message}`;
  } finally {
    uploadContextBtn.disabled = false;
    clearContextBtn.disabled = false;
  }
}

function renderContextStatus() {
  if (!contextMeta || contextItems.length === 0) {
    contextStatusEl.textContent = '未設定';
    updateContextPreviewButtons();
    return;
  }

  const total = Number(contextMeta.totalCount || contextItems.length).toLocaleString('ja-JP');
  const active = Number(contextMeta.activeCount || 0).toLocaleString('ja-JP');
  const chars = Number(contextMeta.charCount || 0).toLocaleString('ja-JP');
  contextStatusEl.textContent = `保存: ${total}件 / 有効: ${active}件 / 有効chars: ${chars}`;
  updateContextPreviewButtons();
}

async function loadContextPreview(resetStart) {
  if (!isContextPreviewOpen) {
    return;
  }
  if (contextItems.length === 0) {
    renderContextPreviewEmpty('保存済みContextなし');
    return;
  }

  if (resetStart) {
    contextPreviewStart = 0;
  }

  const params = new URLSearchParams({
    view: 'preview',
    contextId: contextPreviewTarget,
    start: String(contextPreviewStart),
    limit: String(CONTEXT_PREVIEW_PAGE_CHARS)
  });

  viewContextBtn.disabled = true;
  prevContextBtn.disabled = true;
  nextContextBtn.disabled = true;

  try {
    const response = await fetch(`/api/context?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`preview API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (!data?.preview) {
      renderContextPreviewEmpty('プレビュー対象が空です');
      return;
    }

    contextPreviewStart = Number(data.start || 0);
    contextPreviewEnd = Number(data.end || 0);
    contextPreviewTotal = Number(data.totalChars || 0);

    contextPreviewEl.textContent = data.preview || '(空)';
    if (contextPreviewTotal > 0 && contextPreviewEnd > 0) {
      contextPreviewMetaEl.textContent = `${(contextPreviewStart + 1).toLocaleString('ja-JP')} - ${contextPreviewEnd.toLocaleString('ja-JP')} / ${contextPreviewTotal.toLocaleString('ja-JP')}`;
    } else {
      contextPreviewMetaEl.textContent = '0 / 0';
    }
    updateContextPreviewButtons();
  } catch (error) {
    console.error(error);
    contextPreviewEl.textContent = `プレビュー取得失敗: ${error.message}`;
    contextPreviewMetaEl.textContent = '取得失敗';
    updateContextPreviewButtons();
  } finally {
    viewContextBtn.disabled = false;
  }
}

function renderContextPreviewEmpty(message) {
  contextPreviewStart = 0;
  contextPreviewEnd = 0;
  contextPreviewTotal = 0;
  contextPreviewEl.textContent = message;
  contextPreviewMetaEl.textContent = '0 / 0';
  updateContextPreviewButtons();
}

function setContextPreviewOpen(open, options = {}) {
  const reset = options.reset !== false;
  isContextPreviewOpen = Boolean(open);

  contextPreviewTargetEl.hidden = !isContextPreviewOpen;
  prevContextBtn.hidden = !isContextPreviewOpen;
  nextContextBtn.hidden = !isContextPreviewOpen;
  contextPreviewMetaEl.hidden = !isContextPreviewOpen;
  contextPreviewEl.hidden = !isContextPreviewOpen;
  viewContextBtn.textContent = isContextPreviewOpen ? '表示を隠す' : '内容を表示';

  if (reset) {
    contextPreviewStart = 0;
    contextPreviewEnd = 0;
    contextPreviewTotal = 0;
  }
  if (!isContextPreviewOpen) {
    contextPreviewEl.textContent = '表示するには「内容を表示」を押してください';
    contextPreviewMetaEl.textContent = '0 / 0';
  }
  updateContextPreviewButtons();
}

function updateContextPreviewButtons() {
  const hasContext = contextItems.length > 0;
  viewContextBtn.disabled = !hasContext;
  prevContextBtn.disabled = !hasContext || !isContextPreviewOpen || contextPreviewStart <= 0;
  nextContextBtn.disabled = !hasContext || !isContextPreviewOpen || contextPreviewEnd >= contextPreviewTotal;
  contextPreviewTargetEl.disabled = !hasContext || !isContextPreviewOpen;
}

function renderContextList() {
  contextListEl.innerHTML = '';
  if (contextItems.length === 0) return;

  for (const item of contextItems) {
    const li = document.createElement('li');
    li.className = 'context-item';

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'context-item-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(item.active);
    toggle.addEventListener('change', async () => {
      await updateContextActive(item.id, toggle.checked);
    });
    const toggleText = document.createElement('span');
    toggleText.textContent = '有効';
    toggleWrap.append(toggle, toggleText);

    const meta = document.createElement('div');
    meta.className = 'context-item-meta';
    const title = document.createElement('div');
    title.className = 'context-item-title';
    title.textContent = item.fileName || item.id;
    const sub = document.createElement('div');
    sub.className = 'context-item-sub';
    const chars = Number(item.charCount || 0).toLocaleString('ja-JP');
    const embeddingText = item.embeddingReady ? 'embedding: ready' : 'embedding: pending';
    sub.textContent = `${chars} chars / ${embeddingText} / ${formatDate(item.loadedAt)}`;
    meta.append(title, sub);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'context-item-delete';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', async () => {
      await deleteContextById(item.id);
    });

    li.append(toggleWrap, meta, deleteBtn);
    contextListEl.appendChild(li);
  }
}

function syncContextPreviewTargetOptions() {
  contextPreviewTargetEl.innerHTML = '';

  const optActive = document.createElement('option');
  optActive.value = CONTEXT_PREVIEW_ACTIVE_TARGET;
  optActive.textContent = '有効Contextをまとめて表示';
  contextPreviewTargetEl.appendChild(optActive);

  for (const item of contextItems) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.fileName || item.id;
    contextPreviewTargetEl.appendChild(option);
  }

  const available = new Set([CONTEXT_PREVIEW_ACTIVE_TARGET, ...contextItems.map((x) => x.id)]);
  if (!available.has(contextPreviewTarget)) {
    contextPreviewTarget = contextItems[0]?.id || CONTEXT_PREVIEW_ACTIVE_TARGET;
  }
  contextPreviewTargetEl.value = contextPreviewTarget;
}

async function updateContextActive(changedId, enabled) {
  const nextActive = new Set(
    contextItems.filter((x) => x.active).map((x) => x.id)
  );
  if (enabled) {
    nextActive.add(changedId);
  } else {
    nextActive.delete(changedId);
  }

  try {
    const response = await fetch('/api/context/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeIds: [...nextActive] })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`active update failed ${response.status}: ${body}`);
    }
    contextMeta = await response.json();
    contextItems = Array.isArray(contextMeta.items) ? contextMeta.items : [];
    syncContextPreviewTargetOptions();
    renderContextStatus();
    renderContextList();
    if (isContextPreviewOpen && contextPreviewTarget === CONTEXT_PREVIEW_ACTIVE_TARGET) {
      await loadContextPreview(true);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Context有効化更新失敗: ${error.message}`);
    await loadContextState();
  }
}

async function deleteContextById(contextId) {
  try {
    const response = await fetch(`/api/context?contextId=${encodeURIComponent(contextId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`context delete failed ${response.status}: ${body}`);
    }

    contextMeta = await response.json();
    contextItems = Array.isArray(contextMeta.items) ? contextMeta.items : [];
    if (contextPreviewTarget === contextId) {
      contextPreviewTarget = CONTEXT_PREVIEW_ACTIVE_TARGET;
    }
    syncContextPreviewTargetOptions();
    renderContextStatus();
    renderContextList();
    if (contextItems.length > 0 && isContextPreviewOpen) {
      await loadContextPreview(true);
    } else {
      renderContextPreviewEmpty(contextItems.length > 0 ? '表示するには「内容を表示」を押してください' : '保存済みContextなし');
    }
  } catch (error) {
    console.error(error);
    setStatus(`Context削除失敗: ${error.message}`);
  }
}

function bindGlossaryActions() {
  addGlossaryBtn.addEventListener('click', async () => {
    await addGlossaryEntry();
  });

  glossarySourceEl.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await addGlossaryEntry();
  });
  glossaryTargetEl.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await addGlossaryEntry();
  });
}

function bindRuntimeConfigActions() {
  if (!saveApiConfigBtn || !clearApiKeyBtn) return;

  saveApiConfigBtn.addEventListener('click', async () => {
    await saveRuntimeConfig();
  });

  clearApiKeyBtn.addEventListener('click', async () => {
    await clearRuntimeApiKey();
  });

  const textInputs = [
    openaiApiKeyInput,
    openaiBaseUrlInput,
    openaiTranslationModelInput,
    openaiEmbeddingModelInput,
    openaiTranscribeLowModelInput,
    openaiTranscribeHighModelInput
  ];
  for (const input of textInputs) {
    input?.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      await saveRuntimeConfig();
    });
  }
}

async function loadRuntimeConfig() {
  if (!apiConfigStatusEl) return;

  try {
    const response = await fetch('/api/runtime-config');
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`runtime config API error ${response.status}: ${body}`);
    }
    const data = await response.json();
    applyRuntimeConfigToForm(data);
  } catch (error) {
    console.error(error);
    apiConfigStatusEl.textContent = `API設定取得失敗: ${error.message}`;
  }
}

async function saveRuntimeConfig() {
  if (!saveApiConfigBtn || !clearApiKeyBtn) return;

  saveApiConfigBtn.disabled = true;
  clearApiKeyBtn.disabled = true;

  try {
    const payload = {
      openaiBaseUrl: openaiBaseUrlInput.value.trim(),
      openaiTranslationModel: openaiTranslationModelInput.value.trim(),
      openaiEmbeddingModel: openaiEmbeddingModelInput.value.trim(),
      openaiTranscribeLowModel: openaiTranscribeLowModelInput.value.trim(),
      openaiTranscribeHighModel: openaiTranscribeHighModelInput.value.trim()
    };
    const keyInput = openaiApiKeyInput.value.trim();
    if (keyInput) {
      payload.openaiApiKey = keyInput;
    }

    const response = await fetch('/api/runtime-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`runtime config save failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    applyRuntimeConfigToForm(data);
    setStatus('API設定を保存しました');
  } catch (error) {
    console.error(error);
    apiConfigStatusEl.textContent = `API設定保存失敗: ${error.message}`;
  } finally {
    saveApiConfigBtn.disabled = false;
    clearApiKeyBtn.disabled = !Boolean(runtimeConfigMeta?.hasOpenaiApiKey);
  }
}

async function clearRuntimeApiKey() {
  if (!saveApiConfigBtn || !clearApiKeyBtn) return;

  saveApiConfigBtn.disabled = true;
  clearApiKeyBtn.disabled = true;

  try {
    const response = await fetch('/api/runtime-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiApiKey: '' })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`runtime api key clear failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    applyRuntimeConfigToForm(data);
    setStatus('API Keyを削除しました');
  } catch (error) {
    console.error(error);
    apiConfigStatusEl.textContent = `API Key削除失敗: ${error.message}`;
  } finally {
    saveApiConfigBtn.disabled = false;
    clearApiKeyBtn.disabled = !Boolean(runtimeConfigMeta?.hasOpenaiApiKey);
  }
}

function applyRuntimeConfigToForm(data) {
  runtimeConfigMeta = data || null;
  openaiBaseUrlInput.value = String(data?.openaiBaseUrl || '');
  openaiTranslationModelInput.value = String(data?.openaiTranslationModel || '');
  openaiEmbeddingModelInput.value = String(data?.openaiEmbeddingModel || '');
  openaiTranscribeLowModelInput.value = String(data?.openaiTranscribeLowModel || '');
  openaiTranscribeHighModelInput.value = String(data?.openaiTranscribeHighModel || '');
  openaiApiKeyInput.value = '';

  const masked = String(data?.openaiApiKeyMasked || '').trim();
  if (data?.hasOpenaiApiKey) {
    openaiApiKeyInput.placeholder = masked ? `設定済み: ${masked}` : '設定済み';
  } else {
    openaiApiKeyInput.placeholder = '未設定 (sk-...)';
  }

  clearApiKeyBtn.disabled = !Boolean(data?.hasOpenaiApiKey);
  renderRuntimeConfigStatus(data);
}

function renderRuntimeConfigStatus(data) {
  if (!apiConfigStatusEl) return;

  const keyStatus = data?.hasOpenaiApiKey ? '設定済み' : '未設定';
  const model = String(data?.openaiTranslationModel || '-');
  const baseUrl = String(data?.openaiBaseUrl || '-');
  apiConfigStatusEl.textContent = `API Key: ${keyStatus} / Base URL: ${baseUrl} / 翻訳モデル: ${model}`;
}

async function loadGlossary() {
  try {
    const response = await fetch('/api/glossary');
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`glossary API error ${response.status}: ${body}`);
    }
    const data = await response.json();
    glossaryItems = Array.isArray(data?.items) ? data.items : [];
    renderGlossaryStatus();
    renderGlossaryList();
  } catch (error) {
    console.error(error);
    glossaryStatusEl.textContent = `Glossary取得失敗: ${error.message}`;
  }
}

async function addGlossaryEntry() {
  const source = glossarySourceEl.value.trim();
  const target = glossaryTargetEl.value.trim();
  const notes = glossaryNotesEl.value.trim();

  if (!source || !target) {
    glossaryStatusEl.textContent = '原文用語と訳語を入力してください。';
    return;
  }

  addGlossaryBtn.disabled = true;
  try {
    const response = await fetch('/api/glossary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, notes })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`glossary add failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    glossaryItems = Array.isArray(data?.items) ? data.items : [];
    glossarySourceEl.value = '';
    glossaryTargetEl.value = '';
    glossaryNotesEl.value = '';
    renderGlossaryStatus();
    renderGlossaryList();
    setStatus('Glossaryを追加しました');
  } catch (error) {
    console.error(error);
    glossaryStatusEl.textContent = `追加失敗: ${error.message}`;
  } finally {
    addGlossaryBtn.disabled = false;
  }
}

async function toggleGlossaryItem(id, active) {
  try {
    const response = await fetch('/api/glossary/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`glossary toggle failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    glossaryItems = Array.isArray(data?.items) ? data.items : [];
    renderGlossaryStatus();
    renderGlossaryList();
  } catch (error) {
    console.error(error);
    setStatus(`Glossary更新失敗: ${error.message}`);
    await loadGlossary();
  }
}

async function deleteGlossaryItem(id) {
  try {
    const response = await fetch(`/api/glossary?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`glossary delete failed ${response.status}: ${body}`);
    }
    const data = await response.json();
    glossaryItems = Array.isArray(data?.items) ? data.items : [];
    renderGlossaryStatus();
    renderGlossaryList();
  } catch (error) {
    console.error(error);
    setStatus(`Glossary削除失敗: ${error.message}`);
  }
}

function renderGlossaryStatus() {
  if (!glossaryItems.length) {
    glossaryStatusEl.textContent = '未登録';
    return;
  }
  const active = glossaryItems.filter((item) => item.active).length;
  glossaryStatusEl.textContent = `登録: ${glossaryItems.length}件 / 有効: ${active}件`;
}

function renderGlossaryList() {
  glossaryListEl.innerHTML = '';
  if (!glossaryItems.length) return;

  for (const item of glossaryItems) {
    const li = document.createElement('li');
    li.className = 'context-item';

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'context-item-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(item.active);
    toggle.addEventListener('change', async () => {
      await toggleGlossaryItem(item.id, toggle.checked);
    });
    const toggleText = document.createElement('span');
    toggleText.textContent = '有効';
    toggleWrap.append(toggle, toggleText);

    const meta = document.createElement('div');
    meta.className = 'context-item-meta';
    const title = document.createElement('div');
    title.className = 'context-item-title';
    title.textContent = `${item.source} -> ${item.target}`;
    const sub = document.createElement('div');
    sub.className = 'context-item-sub';
    sub.textContent = item.notes || '';
    meta.append(title, sub);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'glossary-item-delete';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', async () => {
      await deleteGlossaryItem(item.id);
    });

    li.append(toggleWrap, meta, deleteBtn);
    glossaryListEl.appendChild(li);
  }
}

async function loadHistory() {
  try {
    const response = await fetch('/api/history?limit=100');
    if (!response.ok) {
      throw new Error(`history API error ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items : [];
    historyListEl.innerHTML = '';

    items.forEach((item) => {
      prependHistoryItem(item, false);
    });
  } catch (error) {
    console.error(error);
    setStatus('履歴取得に失敗しました');
  }
}

function prependHistoryItem(item, enforceMax = true) {
  const li = document.createElement('li');
  li.className = 'history-item';

  const time = document.createElement('div');
  time.className = 'history-time';
  const sourceLang = normalizeSourceLanguage(item.sourceLanguage || settings.sourceLanguage);
  const targetLang = normalizeTargetLanguage(item.targetLanguage || settings.targetLanguage);
  time.textContent = `${formatDate(item.createdAt)} / ${labelMode(item.mode)} / ${languageLabel(sourceLang)} -> ${languageLabel(targetLang)}`;

  const trans = document.createElement('div');
  trans.className = 'history-translation';
  trans.textContent = item.translation || '';

  li.appendChild(time);
  li.appendChild(trans);
  historyListEl.prepend(li);

  if (enforceMax) {
    while (historyListEl.children.length > MAX_HISTORY_ITEMS) {
      historyListEl.lastChild?.remove();
    }
  }
}

function publishSubtitle(text) {
  overlayLines.push(text);
  while (overlayLines.length > MAX_OVERLAY_LINES) {
    overlayLines.shift();
  }

  if (isElectron) {
    window.electronAPI.pushSubtitle(text);
    return;
  }

  renderBrowserOverlay();
}

function renderBrowserOverlay() {
  overlayEl.innerHTML = '';
  overlayLines.forEach((line) => {
    const div = document.createElement('div');
    div.className = 'subtitle-line';
    div.textContent = line;
    overlayEl.appendChild(div);
  });
}

function initOverlayMode() {
  if (isElectron) {
    overlayToggleWrap.hidden = false;
    overlayEl.style.display = 'none';
    window.electronAPI
      .getOverlayState()
      .then((state) => {
        overlayToggle.checked = Boolean(state?.visible);
      })
      .catch(() => {
        overlayToggle.checked = true;
      });
    overlayToggle.addEventListener('change', async () => {
      try {
        await window.electronAPI.setOverlayVisible(overlayToggle.checked);
      } catch (error) {
        console.error(error);
        setStatus(`オーバーレイ切替失敗: ${error.message}`);
      }
    });
    return;
  }

  overlayToggleWrap.hidden = true;
}

function currentMode() {
  return modeSelect.value === 'high_accuracy' ? 'high_accuracy' : 'low_latency';
}

function labelMode(mode) {
  return mode === 'high_accuracy' ? '高精度' : '低遅延';
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setMicState(kind, text) {
  micStatusTextEl.className = `mic-state ${kind}`;
  micStatusTextEl.textContent = text;
}

function pickSupportedMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function formatDate(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  return date.toLocaleString('ja-JP', {
    hour12: false
  });
}

async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }

  return btoa(binary);
}

async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }

  return btoa(binary);
}

function initSettings() {
  loadSettingsFromStorage();
  setupLanguageSelectors();
  bindSettingInputs();
  refreshSettingBadges();
  applyOverlayStyle();
}

function setupLanguageSelectors() {
  sourceLanguageSelect.innerHTML = '';
  targetLanguageSelect.innerHTML = '';

  for (const lang of SUPPORTED_SOURCE_LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.label;
    sourceLanguageSelect.appendChild(option);
  }

  for (const lang of SUPPORTED_TARGET_LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.label;
    targetLanguageSelect.appendChild(option);
  }

  settings.sourceLanguage = normalizeSourceLanguage(settings.sourceLanguage);
  settings.targetLanguage = normalizeTargetLanguage(settings.targetLanguage);

  if (settings.sourceLanguage !== 'auto' && settings.sourceLanguage === settings.targetLanguage) {
    settings.targetLanguage = settings.targetLanguage === 'en' ? 'ja' : 'en';
  }
}

function bindSettingInputs() {
  for (const [key, id] of Object.entries(settingInputIds)) {
    const input = document.getElementById(id);
    if (!input) continue;

    if (input.type === 'checkbox') {
      input.checked = Boolean(settings[key]);
    } else if (input.type === 'color' || input.tagName === 'SELECT') {
      input.value = settings[key];
    } else {
      input.value = String(settings[key]);
    }

    const onSettingChange = () => {
      updateSettingFromInput(key, input);
      refreshSettingBadges();
      saveSettingsToStorage();

      if (isOverlayStyleKey(key)) {
        applyOverlayStyle();
      }
    };

    input.addEventListener('input', onSettingChange);
    input.addEventListener('change', onSettingChange);
  }
}

function updateSettingFromInput(key, input) {
  const raw = input.type === 'checkbox' ? input.checked : input.value;

  switch (key) {
    case 'sourceLanguage':
      settings.sourceLanguage = normalizeSourceLanguage(raw);
      if (settings.sourceLanguage !== 'auto' && settings.sourceLanguage === settings.targetLanguage) {
        settings.targetLanguage = settings.targetLanguage === 'en' ? 'ja' : 'en';
        targetLanguageSelect.value = settings.targetLanguage;
      }
      break;
    case 'targetLanguage':
      settings.targetLanguage = normalizeTargetLanguage(raw);
      if (settings.sourceLanguage !== 'auto' && settings.sourceLanguage === settings.targetLanguage) {
        settings.sourceLanguage = 'auto';
        sourceLanguageSelect.value = settings.sourceLanguage;
      }
      break;
    case 'segmentMsLow':
      settings.segmentMsLow = clampInt(raw, 700, 5000, DEFAULT_TUNING_SETTINGS.segmentMsLow);
      break;
    case 'segmentMsHigh':
      settings.segmentMsHigh = clampInt(raw, 1500, 9000, DEFAULT_TUNING_SETTINGS.segmentMsHigh);
      break;
    case 'flushCharsLow':
      settings.flushCharsLow = clampInt(raw, 12, 180, DEFAULT_TUNING_SETTINGS.flushCharsLow);
      break;
    case 'flushCharsHigh':
      settings.flushCharsHigh = clampInt(raw, 12, 260, DEFAULT_TUNING_SETTINGS.flushCharsHigh);
      break;
    case 'flushHoldLowMs':
      settings.flushHoldLowMs = clampInt(raw, 1200, 14000, DEFAULT_TUNING_SETTINGS.flushHoldLowMs);
      break;
    case 'flushHoldHighMs':
      settings.flushHoldHighMs = clampInt(raw, 1800, 18000, DEFAULT_TUNING_SETTINGS.flushHoldHighMs);
      break;
    case 'noiseThreshold':
      settings.noiseThreshold = clampFloat(raw, 0.005, 0.08, 0.016);
      break;
    case 'noiseMinVoiceMs':
      settings.noiseMinVoiceMs = clampInt(raw, 40, 1200, 180);
      break;
    case 'ignoreFillers':
      settings.ignoreFillers = Boolean(raw);
      break;
    case 'useContextTranscription':
      settings.useContextTranscription = Boolean(raw);
      break;
    case 'useContextTranslation':
      settings.useContextTranslation = Boolean(raw);
      break;
    case 'overlayFontSize':
      settings.overlayFontSize = clampInt(raw, 14, 96, 32);
      break;
    case 'overlayBottom':
      settings.overlayBottom = clampInt(raw, 0, 200, 14);
      break;
    case 'overlayTextColor':
      settings.overlayTextColor = sanitizeHexColor(raw, '#ffffff');
      break;
    case 'overlayBgColor':
      settings.overlayBgColor = sanitizeHexColor(raw, '#000000');
      break;
    case 'overlayBgOpacity':
      settings.overlayBgOpacity = clampFloat(raw, 0.2, 1, 0.78);
      break;
    case 'overlayRadius':
      settings.overlayRadius = clampInt(raw, 0, 40, 10);
      break;
    default:
      break;
  }

  if (input.type === 'checkbox') {
    input.checked = Boolean(settings[key]);
  } else {
    input.value = String(settings[key]);
  }
}

function refreshSettingBadges() {
  noiseThresholdValueEl.textContent = settings.noiseThreshold.toFixed(3);
  overlayBgOpacityValueEl.textContent = settings.overlayBgOpacity.toFixed(2);
}

function isOverlayStyleKey(key) {
  return (
    key === 'overlayFontSize' ||
    key === 'overlayBottom' ||
    key === 'overlayTextColor' ||
    key === 'overlayBgColor' ||
    key === 'overlayBgOpacity' ||
    key === 'overlayRadius'
  );
}

function applyOverlayStyle() {
  const style = {
    textColor: settings.overlayTextColor,
    bgColor: settings.overlayBgColor,
    bgOpacity: settings.overlayBgOpacity,
    fontSize: settings.overlayFontSize,
    bottom: settings.overlayBottom,
    radius: settings.overlayRadius
  };

  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--subtitle-text-color', style.textColor);
  rootStyle.setProperty('--subtitle-bg-rgba', hexToRgba(style.bgColor, style.bgOpacity));
  rootStyle.setProperty('--subtitle-font-size-px', `${style.fontSize}px`);
  rootStyle.setProperty('--subtitle-bottom-px', `${style.bottom}px`);
  rootStyle.setProperty('--subtitle-radius-px', `${style.radius}px`);

  renderBrowserOverlay();

  if (isElectron && window.electronAPI.setOverlayStyle) {
    window.electronAPI.setOverlayStyle(style).catch((error) => {
      console.error(error);
      setStatus(`オーバーレイ反映失敗: ${error.message}`);
    });
  }
}

function saveSettingsToStorage() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function loadSettingsFromStorage() {
  try {
    const rawV3 = localStorage.getItem(SETTINGS_STORAGE_KEY);
    const rawLegacy = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    const raw = rawV3 || rawLegacy;
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    settings.sourceLanguage = normalizeSourceLanguage(parsed.sourceLanguage);
    settings.targetLanguage = normalizeTargetLanguage(parsed.targetLanguage);
    settings.segmentMsLow = clampInt(parsed.segmentMsLow, 700, 5000, settings.segmentMsLow);
    settings.segmentMsHigh = clampInt(parsed.segmentMsHigh, 1500, 9000, settings.segmentMsHigh);
    settings.flushCharsLow = clampInt(parsed.flushCharsLow, 12, 180, settings.flushCharsLow);
    settings.flushCharsHigh = clampInt(parsed.flushCharsHigh, 12, 260, settings.flushCharsHigh);
    settings.flushHoldLowMs = clampInt(parsed.flushHoldLowMs, 1200, 14000, settings.flushHoldLowMs);
    settings.flushHoldHighMs = clampInt(parsed.flushHoldHighMs, 1800, 18000, settings.flushHoldHighMs);
    settings.noiseThreshold = clampFloat(parsed.noiseThreshold, 0.005, 0.08, settings.noiseThreshold);
    settings.noiseMinVoiceMs = clampInt(parsed.noiseMinVoiceMs, 40, 1200, settings.noiseMinVoiceMs);
    settings.ignoreFillers = typeof parsed.ignoreFillers === 'boolean' ? parsed.ignoreFillers : settings.ignoreFillers;
    settings.useContextTranscription =
      typeof parsed.useContextTranscription === 'boolean'
        ? parsed.useContextTranscription
        : settings.useContextTranscription;
    settings.useContextTranslation =
      typeof parsed.useContextTranslation === 'boolean'
        ? parsed.useContextTranslation
        : settings.useContextTranslation;
    settings.overlayFontSize = clampInt(parsed.overlayFontSize, 14, 96, settings.overlayFontSize);
    settings.overlayBottom = clampInt(parsed.overlayBottom, 0, 200, settings.overlayBottom);
    settings.overlayTextColor = sanitizeHexColor(parsed.overlayTextColor, settings.overlayTextColor);
    settings.overlayBgColor = sanitizeHexColor(parsed.overlayBgColor, settings.overlayBgColor);
    settings.overlayBgOpacity = clampFloat(parsed.overlayBgOpacity, 0.2, 1, settings.overlayBgOpacity);
    settings.overlayRadius = clampInt(parsed.overlayRadius, 0, 40, settings.overlayRadius);

    if (!rawV3 && rawLegacy) {
      applyDefaultTuningSettings();
      saveSettingsToStorage();
    }
  } catch {
    // ignore parse errors
  }
}

function applyDefaultTuningSettings() {
  settings.segmentMsLow = DEFAULT_TUNING_SETTINGS.segmentMsLow;
  settings.segmentMsHigh = DEFAULT_TUNING_SETTINGS.segmentMsHigh;
  settings.flushCharsLow = DEFAULT_TUNING_SETTINGS.flushCharsLow;
  settings.flushCharsHigh = DEFAULT_TUNING_SETTINGS.flushCharsHigh;
  settings.flushHoldLowMs = DEFAULT_TUNING_SETTINGS.flushHoldLowMs;
  settings.flushHoldHighMs = DEFAULT_TUNING_SETTINGS.flushHoldHighMs;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text.toLowerCase();
  }
  return fallback;
}

function normalizeSourceLanguage(value) {
  const code = String(value || '').toLowerCase();
  if (SUPPORTED_SOURCE_LANGUAGES.some((lang) => lang.code === code)) {
    return code;
  }
  return 'ja';
}

function normalizeTargetLanguage(value) {
  const code = String(value || '').toLowerCase();
  if (SUPPORTED_TARGET_LANGUAGES.some((lang) => lang.code === code)) {
    return code;
  }
  return 'en';
}

function languageLabel(code) {
  const target = SUPPORTED_SOURCE_LANGUAGES.find((lang) => lang.code === code);
  return target ? target.label : code;
}

function hexToRgba(hex, alpha) {
  const h = sanitizeHexColor(hex, '#000000');
  const a = clampFloat(alpha, 0, 1, 1);
  const r = Number.parseInt(h.slice(1, 3), 16);
  const g = Number.parseInt(h.slice(3, 5), 16);
  const b = Number.parseInt(h.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

async function ensureAnalyzer(stream) {
  if (audioContext) {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    return;
  }

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.7;
  analyserData = new Uint8Array(analyserNode.fftSize);

  source.connect(analyserNode);
  lastMeterTickMs = performance.now();
  meterRafId = requestAnimationFrame(tickMeter);
}

function tickMeter() {
  if (!analyserNode || !analyserData) return;

  analyserNode.getByteTimeDomainData(analyserData);

  let sum = 0;
  for (let i = 0; i < analyserData.length; i += 1) {
    const sample = (analyserData[i] - 128) / 128;
    sum += sample * sample;
  }

  currentRms = Math.sqrt(sum / analyserData.length);
  const now = performance.now();
  const dt = Math.min(120, Math.max(0, now - lastMeterTickMs));
  lastMeterTickMs = now;

  updateMicMeter(currentRms);
  updateMicState(currentRms);

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    segmentStats.totalMs += dt;
    segmentStats.peakRms = Math.max(segmentStats.peakRms, currentRms);
    if (currentRms >= settings.noiseThreshold) {
      segmentStats.voicedMs += dt;
      lastSpeechDetectedAt = Date.now();
    }
  }

  meterRafId = requestAnimationFrame(tickMeter);
}

function resetSegmentStats() {
  segmentStats.voicedMs = 0;
  segmentStats.totalMs = 0;
  segmentStats.peakRms = 0;
}

function updateMicMeter(rms) {
  const normalized = Math.min(100, Math.round((rms / 0.08) * 100));
  micLevelBarEl.style.width = `${normalized}%`;
}

function updateMicState(rms) {
  if (!isRecording) {
    setMicState('idle', '待機中');
    return;
  }

  if (Date.now() < gateFeedbackUntilMs) {
    setMicState('gated', 'ノイズ除外');
    return;
  }

  if (rms >= settings.noiseThreshold) {
    setMicState('speech', '音声検出');
  } else {
    setMicState('listening', '入力待機中');
  }
}
