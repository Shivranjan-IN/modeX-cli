# Modex CLI

**ONE CLI. EVERY MODEL. FREE-FIRST CODING.**

A free-first AI coding agent that routes through free models automatically. No API keys required for free providers.

![Modex CLI Demo](https://img.shields.io/badge/version-0.0.1-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.19-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

- **Free-First Routing** — Automatically uses free models (Groq, Cerebras, NVIDIA, OpenRouter, Together, Fireworks)
- **Auto-Fallback** — If a model fails (rate limit, auth, quota), falls back to the next free model
- **Zero Config** — Works out of the box with NVIDIA API key (already in your env)
- **Visual UI** — ASCII logo, bordered input box, model selector with search/filter
- **Interactive REPL** — Multiline input, command history, @ file references
- **Smart Commands** — `/model`, `/providers`, `/status`, `/doctor`, `/theme`, `/verbose`, more
- **Granular Permissions** — Allow/deny per tool, path, or glob pattern
- **Project Awareness** — Git status, package scripts, TypeScript detection
- **Themes** — Orange (default), Blue, Green, Purple, Cyan, Monochrome

---

## Quick Install

### Option 1: One-liner (Recommended)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/modex-cli/modex/main/install.sh | bash
```

**Windows PowerShell:**
```powershell
iwr https://raw.githubusercontent.com/modex-cli/modex/main/install.ps1 -UseBasicParsing | iex
```

**Node.js (Cross-platform):**
```bash
npx @modex/cli@latest
# Or install globally
npm install -g @modex/cli
```

### Option 2: From Source

```bash
git clone https://github.com/modex-cli/modex.git
cd modex
npm install
npm run build
npm link
```

---

## Free API Keys (Optional but Recommended)

Add to `~/.modex/.env` or your shell profile:

```bash
# Free providers (no --paid needed)
GROQ_API_KEY=gsk_...           # https://console.groq.com/keys
CEREBRAS_API_KEY=csk-...       # https://cloud.cerebras.ai/
TOGETHER_API_KEY=...           # https://api.together.ai/settings/api-keys
FIREWORKS_API_KEY=fw_...       # https://fireworks.ai/keys
OPENROUTER_API_KEY=skor-...    # https://openrouter.ai/keys
NVIDIA_API_KEY=nvapi-...       # https://build.nvidia.com/

# Paid provider (requires --paid flag)
OPENAI_API_KEY=sk-...          # https://platform.openai.com/api-keys
```

> **Note:** NVIDIA API key works out of the box if already in your environment.

---

## Usage

```bash
# Interactive REPL (with visual UI)
modex

# Pick model at startup, then REPL
modex --pick

# Pick model, one-shot answer
modex --pick "explain this codebase"

# One-shot question
modex "list all TypeScript files in src/"

# Resume last session
modex --continue

# Resume specific session
modex --resume <session-id>

# Use paid models (explicit opt-in)
modex --paid --model gpt-5 "refactor carefully"
```

---

## REPL Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help and shortcuts |
| `/models` | List all models (free vs paid, key status) |
| `/model [pattern]` | Switch model or run visual selector |
| `/providers` | View configured providers and key status |
| `/connect [name]` | Configure a provider (shows setup URLs) |
| `/status` | Show project, git, model, tokens, routing |
| `/clear` | Clear visible conversation (keeps session) |
| `/compact` | Reduce conversation context to last 10 messages |
| `/permissions` | View tool permission settings |
| `/doctor` | Diagnose configuration and connectivity |
| `/theme [name]` | Change theme (orange, blue, green, purple, cyan, monochrome) |
| `/verbose` | Toggle tool output display (on/off) |
| `/sessions` | List saved sessions |
| `/session <id>` | Hint for resuming a session |
| `/new` | Start a fresh conversation context |
| `/quit` | Exit (Ctrl+C also works) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+J` | New line in multiline mode |
| `Ctrl+C` | Cancel current turn / Exit |
| `↑` / `↓` | Command history |
| `Tab` | Auto-complete (when available) |

---

## Example Workflow

```bash
$ modex --pick
# Select model from visual picker

$ modex "create a React todo app with TypeScript"
# Agent writes files, runs commands

$ modex --continue
# Resume previous session
```

---

## Free-First Routing

Modex **never** silently uses paid models:

1. Selects verified free model based on context window, quota, capabilities
2. On failure (rate limit, 401, 404, quota) → auto-fallback to next free model
3. Auth failures skip entire provider (e.g., dead OpenRouter key → jumps to NVIDIA)
4. Paid models **blocked** unless `--paid` flag used
5. See routing decisions with `/status` and `/doctor`

---

## Themes

```bash
/theme              # List themes
/theme blue         # Switch to blue theme
/theme green        # Switch to green theme
# Available: orange (default), blue, green, purple, cyan, monochrome
```

---

## Project Awareness

Modex understands your project:
- Git branch, status, ahead/behind
- Package.json scripts (dev, build, test, lint)
- Package manager (npm, yarn, pnpm, bun)
- TypeScript config detection
- Test framework detection

---

## Permissions

Granular control per tool:
- `y` / `yes` — allow once
- `a` / `always` — allow always for this tool
- `p` / `path-only` — allow for this specific path
- `g` / `glob` — allow for glob pattern (e.g., `src/**/*.ts`)
- `d` / `deny-always` — deny always for this tool

View with `/permissions`.

---

## Requirements

- **Node.js 22.19+**
- **npm** (comes with Node.js)

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Links

- **GitHub**: https://github.com/modex-cli/modex
- **Issues**: https://github.com/modex-cli/modex/issues
- **Discussions**: https://github.com/modex-cli/modex/discussions

---

*Modex CLI — Free-first coding for everyone.*