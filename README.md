# Realtime Subtitle Translator (Electron Overlay)

ローカルで動く音声翻訳アプリです。Electronで起動し、PC画面上に翻訳字幕のオーバーレイウィンドウを表示します。

- 入力: マイク音声（多言語）
- 出力: 翻訳字幕（PCオーバーレイ）
- 翻訳方式: OpenAI API（文字起こし + 翻訳）
- 履歴: `data/history.jsonl` にローカル保存
- context索引: `data/context.jsonl` にローカル保存（複数ファイル蓄積）
- context埋め込み索引: `data/context_embeddings.json` にローカル保存
- glossary: `data/glossary.json` にローカル保存
- モード: `低遅延` / `高精度`
- 表示改善: 文字起こし断片を文単位にまとめて翻訳（細切れ字幕を抑制）
- 多言語: UIで入力言語/出力言語を選択可能
- フィラー除去: UIからON/OFF可能

## 要件

- Node.js 18.17+
- OpenAI APIキー
- （任意）埋め込みモデルを変える場合は `OPENAI_EMBEDDING_MODEL`

## セットアップ

```bash
cp .env.example .env
# .env を編集して OPENAI_API_KEY を設定
npm install
npm start
```

`npm start` で以下が同時に起動します。
- ローカルAPIサーバー (`127.0.0.1:3000`)
- 操作用のメインウィンドウ
- 透明の常時最前面オーバーレイウィンドウ

## 使い方

1. メインウィンドウで入力言語/出力言語とモードを選択（低遅延 / 高精度）
2. `開始` を押す
3. マイクで話す
4. PCオーバーレイに翻訳字幕が逐次表示される
5. 必要なら `PCオーバーレイ表示` をOFFにして非表示化
6. `停止` で終了

## UI設定

- `チューニング` パネルで、セグメント長・flush条件・ノイズゲート閾値をリアルタイム変更できます。
- `入力言語` と `出力言語` をUIで選択できます。
  - 例: 日本語 / English / 中文 / 한국어 / Español / Français / Deutsch / Italiano / Português
- `フィラー除去` をONにすると、えー/あの/um などのつなぎ語を翻訳時に抑制します。
- `Context File` で PDF/PPTX/DOCX/TXT/MD を読み込めます。
- `Context File` は `追加` で蓄積され、一覧から有効/無効や個別削除ができます。
- `Context File` で読み込んだ内容は `内容を表示` からUI上でページ送り確認できます（有効まとめ表示/個別表示）。
- `Glossary` で用語対訳を追加し、有効/無効・削除ができます（翻訳時に優先反映）。
- 翻訳時に直近の字幕履歴を自動参照し、文脈整合性を上げています。
- `contextを音声認識に利用` と `contextを翻訳に利用` を個別にON/OFFできます。
- `マイク入力` でレベルメーターと状態（待機/入力待機中/音声検出/ノイズ除外）を確認できます。
- `オーバーレイ表示` パネルで、文字サイズ・色・背景不透明度・位置・角丸を変更できます。
- 設定値はブラウザの `localStorage` に保存され、次回起動時に復元されます。

## スクリプト

- `npm start`: Electron版を起動
- `npm run start:web`: APIサーバーのみ起動（ブラウザ確認用）

## API

- `POST /api/transcribe`
  - 入力: `{ audioBase64, mimeType, mode, sourceLanguage, useContextForTranscription }`
  - 出力: `{ createdAt, mode, sourceLanguage, usedContext, transcript }`
- `POST /api/translate`
  - 入力: `{ transcript, mode, sourceLanguage, targetLanguage, ignoreFillers, useContextForTranslation }`
  - 出力: `{ createdAt, mode, sourceLanguage, targetLanguage, ignoreFillers, usedContext, transcript, translation }`
- `GET /api/context`
  - 出力: `{ loaded, totalCount, activeCount, activeIds, items, ... }`
  - `GET /api/context?view=preview&contextId=__active__&start=0&limit=3200` でcontext本文プレビュー取得
- `POST /api/context`
  - 入力: `{ fileName, mimeType, fileBase64 }`
  - 出力: `GET /api/context` と同等
- `POST /api/context/active`
  - 入力: `{ activeIds: ["ctx_..."] }`
  - 出力: `GET /api/context` と同等
- `DELETE /api/context`
  - 出力: 全context削除後のサマリー
- `DELETE /api/context?contextId=ctx_...`
  - 出力: 指定context削除後のサマリー
- `GET /api/history?limit=100`
  - 出力: `{ items: [...] }`
- `GET /api/glossary`
  - 出力: `{ totalCount, activeCount, items }`
- `POST /api/glossary`
  - 入力: `{ source, target, notes }`
  - 出力: `GET /api/glossary` と同等
- `POST /api/glossary/toggle`
  - 入力: `{ id, active }`
  - 出力: `GET /api/glossary` と同等
- `DELETE /api/glossary?id=gls_...`
  - 出力: `GET /api/glossary` と同等

## メモ

- APIキーはサーバー側のみで保持され、レンダラーには渡しません。
- オーバーレイウィンドウはクリック透過です。
- macOSでは初回マイク権限の許可が必要です。
- `npm start` は `ELECTRON_RUN_AS_NODE` を自動でunsetして起動します。
