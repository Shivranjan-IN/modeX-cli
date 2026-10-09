#!/usr/bin/env bash
# Modex CLI - Quick Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/modex-cli/modex/main/install.sh | bash

set -euo pipefail

MODEX_VERSION="${MODEX_VERSION:-latest}"
INSTALL_DIR="${MODEX_INSTALL_DIR:-$HOME/.modex/bin}"
NPM_REGISTRY="${MODEX_NPM_REGISTRY:-https://registry.npmjs.org}"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}[modex]${NC} $*"; }
success() { echo -e "${GREEN}[modex]${NC} $*"; }
warn() { echo -e "${YELLOW}[modex]${NC} $*"; }
error() { echo -e "${RED}[modex]${NC} $*" >&2; }

check_node() {
	if ! command -v node >/dev/null 2>&1; then
		error "Node.js not found. Please install Node.js 22+ first."
		error "Visit https://nodejs.org/ or use your package manager."
		exit 1
	fi

	local node_version
	node_version=$(node --version | sed 's/^v//')
	local major_version
	major_version=$(echo "$node_version" | cut -d. -f1)

	if [ "$major_version" -lt 22 ]; then
		error "Node.js 22+ required. Found: $node_version"
		exit 1
	fi

	log "Node.js $node_version ✓"
}

check_npm() {
	if ! command -v npm >/dev/null 2>&1; then
		error "npm not found. Please install Node.js with npm."
		exit 1
	fi
	log "npm $(npm --version) ✓"
}

install_modex() {
	log "Installing Modex CLI..."

	if [ "$MODEX_VERSION" = "latest" ]; then
		npm install -g @modex/cli@latest --registry="$NPM_REGISTRY"
	else
		npm install -g @modex/cli@"$MODEX_VERSION" --registry="$NPM_REGISTRY"
	fi

	success "Modex CLI installed globally"
}

verify_install() {
	if command -v modex >/dev/null 2>&1; then
		local version
		version=$(modex --version 2>/dev/null || echo "unknown")
		success "Modex CLI $version is ready!"
		log "Run 'modex' to start"
	else
		warn "Modex installed but not in PATH"
		log "Add to your shell config (~/.bashrc, ~/.zshrc, etc.):"
		echo "  export PATH=\"\$HOME/.modex/bin:\$PATH\""
		log "Or run with npx: npx @modex/cli"
	fi
}

main() {
	echo
	echo "███╗   ███╗ ██████╗ ██████╗ ███████╗██╗  ██╗"
	echo "████╗ ████║██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝"
	echo "██╔████╔██║██║   ██║██║  ██║█████╗   ╚███╔╝ "
	echo "██║╚██╔╝██║██║   ██║██║  ██║██╔══╝   ██╔██╗ "
	echo "██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗██╔╝ ██╗"
	echo "╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝"
	echo "        ONE CLI. EVERY MODEL. FREE-FIRST."
	echo

	check_node
	check_npm
	install_modex
	verify_install

	echo
	log "Quick start:"
	echo "  modex                 # Interactive REPL"
	echo "  modex --pick          # Choose model, then chat"
	echo "  modex \"your question\" # One-shot"
	echo
	log "Free API keys (add to ~/.modex/.env):"
	echo "  GROQ_API_KEY=gsk_...        https://console.groq.com/keys"
	echo "  CEREBRAS_API_KEY=csk-...    https://cloud.cerebras.ai/"
	echo "  NVIDIA_API_KEY=nvapi-...    https://build.nvidia.com/"
	echo "  OPENROUTER_API_KEY=skor-... https://openrouter.ai/keys"
	echo
}

main "$@"