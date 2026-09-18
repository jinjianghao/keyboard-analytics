# Keyboard Statistics

> **🌐 Language**: [**简体中文**](./README.md) · English

**Your Mac keyboard has been quietly writing a personal data report about you.**

A macOS desktop app that runs silently in the background, recording every keypress, shortcut, and mouse click — then turns that data into a clean live dashboard, plus an AI assistant you can ask anything about your usage.

## What It Does For You

**📊 Your "fingerprint GDP" at a glance**
- Real-time tracking of today's / yesterday's keypress totals, so you always know how much you've actually produced
- Top 10 most-pressed keys — meet your golden fingers
- Cumulative session timer that charts your focused working time

**⌨️ Invisible global tracking**
- Works across every app: coding, writing, gaming, browsing — all captured
- Plain keys, keyboard shortcuts, and mouse left/right/middle clicks are categorized cleanly
- Data lives only in a local SQLite database — never uploaded, never leaves your machine

**🤖 An AI assistant that actually "reads the numbers"**
- No SQL required. Just ask: "Which key did I press most today?" or "What's my mouse-to-keyboard ratio this week?"
- A built-in Agent queries the database for you and answers in conversation
- Works with many providers: Baidu Qianfan / OpenAI / DeepSeek / Qwen / any custom endpoint

**🔑 One-line setup, chat instantly**
- Built-in presets for major providers — pick one, paste your API Key, save. No config files to touch
- Connection is tested on save; if something's wrong, it tells you exactly what — no more silent failures

## Why Choose It?

- **Privacy-first**: touches nothing beyond your input events; statistics never leave this Mac
- **Lightweight & quiet**: sits in the background without interrupting or popping up; expand it whenever you want
- **Developer-friendly**: full TypeScript stack with clean module boundaries — readable and easy to hack on
- **Ready to ship**: built-in build config packages dmg/zip with one command, share it with friends anytime

## Getting Started

### Prerequisites

- macOS 10.15+
- Node.js ≥ 22.18 (22 LTS or newer recommended)
- npm

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

> On first launch, grant the app permission under **System Settings → Privacy & Security → Accessibility**, otherwise global input tracking won't work.

### Build for distribution

```bash
npm run dist        # produces macOS .dmg + .zip in dist/
```

## Setting Up the AI Assistant

Statistics work fully offline; the AI assistant needs a large-model API that you bring yourself:

1. Click the **💬 AI Assistant** button (bottom-right)
2. If not configured, click **Configure** (before setup the assistant clearly guides you — no silent failure)
3. Pick a provider and paste your **API Key**
4. Click **Save** → connection is tested → takes effect immediately, no restart needed

Your key is stored only in the local `ai-config.json` (gitignored); `.env` can be used as a fallback (see `.env.example`).

## Project Structure

```
src/
├── main/        # Electron main process: window, global listeners, event collector, IPC
├── preload/     # contextBridge-exposed restricted API
├── renderer/    # React UI: stats panel, AI chat, settings
├── mastra/      # AI Agent, Hono server, read-only SQLite tools
└── shared/      # type contracts, SQLite data layer, AI config module
```

## Where Data Lives

- Development: `keyboard_stats.db` at project root
- Installed app: `~/Library/Application Support/keyboard-stats/`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run in development |
| `npm run typecheck` | Type check |
| `npm run build` | Build (includes mastra output) |
| `npm run dist` | Package macOS installer |
| `npm run rebuild:native` | Rebuild sqlite3/uiohook native modules |