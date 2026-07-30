#!/usr/bin/env bash
# kde-core Installation Script
# Installs kde-core into target repository

set -e

# Configuration
KDE_CORE_VERSION="1.0.0"
MODE="${MODE:-MODE_2}"  # Default to MODE 2 (Fused)
INSTALL_DIR="kde-core"
BACKUP_DIR=".kde-backup"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get source directory (where this script is located)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KDE_CORE_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
    cat << EOF
Usage: install.sh [OPTIONS]

Install kde-core into the current repository.

OPTIONS:
    -m, --mode MODE         Installation mode: MODE_1 or MODE_2 (default: MODE_2)
    -d, --dir DIR           Installation directory (default: kde-core)
    -n, --no-git            Skip gitignore updates
    -y, --yes               Skip confirmation prompts
    -h, --help              Show this help message

EXAMPLES:
    ./install.sh                        # Install with defaults
    ./install.sh --mode MODE_1          # Install Markdown mode
    ./install.sh --dir my-kde --yes     # Silent install

EOF
}

confirm() {
    local prompt="$1"
    local response
    
    if [[ "$SKIP_CONFIRM" == "true" ]]; then
        return 0
    fi
    
    read -p "$prompt [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY]) 
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

check_requirements() {
    log_info "Checking requirements..."
    
    # Check Python version
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is required but not installed."
        exit 1
    fi
    
    local python_version=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')
    local required_version="3.8"
    
    if [[ $(echo -e "$python_version\n$required_version" | sort -V | head -n1) != "$required_version" ]]; then
        log_error "Python 3.8+ is required. Found: $python_version"
        exit 1
    fi
    
    log_info "Python version: $python_version ✓"
    
    # Check pyyaml
    if ! python3 -c "import yaml" &> /dev/null; then
        log_warn "pyyaml not installed. Installing..."
        pip3 install pyyaml
    fi
    
    log_info "All requirements satisfied ✓"
}

backup_existing() {
    if [[ -d "$INSTALL_DIR" ]]; then
        log_warn "Existing kde-core found."
        
        if confirm "Backup existing installation and continue?"; then
            local backup_name="${BACKUP_DIR}-$(date +%Y%m%d-%H%M%S)"
            mv "$INSTALL_DIR" "$backup_name"
            log_info "Backed up to: $backup_name"
        else
            log_error "Installation cancelled."
            exit 1
        fi
    fi
}

install_files() {
    log_info "Installing kde-core v${KDE_CORE_VERSION}..."
    
    # Create installation directory
    mkdir -p "$INSTALL_DIR"
    
    # Copy core files
    log_info "Copying core runtime..."
    cp -r "$KDE_CORE_DIR/runtime" "$INSTALL_DIR/"
    
    log_info "Copying seeds..."
    cp -r "$KDE_CORE_DIR/seeds" "$INSTALL_DIR/"
    
    log_info "Copying skills..."
    mkdir -p "$INSTALL_DIR/seeds/.agents/skills"
    cp -r "$KDE_CORE_DIR/seeds/.agents/skills/"* "$INSTALL_DIR/seeds/.agents/skills/" 2>/dev/null || true
    
    # Copy mode-specific files
    if [[ "$MODE" == "MODE_2" ]]; then
        log_info "Installing MODE 2 (Fused)..."
        cp -r "$KDE_CORE_DIR/fused-runtime" "$INSTALL_DIR/"
    else
        log_info "Installing MODE 1 (Markdown)..."
        cp -r "$KDE_CORE_DIR/engines" "$INSTALL_DIR/" 2>/dev/null || true
        cp -r "$KDE_CORE_DIR/governance" "$INSTALL_DIR/" 2>/dev/null || true
    fi
    
    # Copy config and docs
    cp "$KDE_CORE_DIR/config/kde-core.yaml" "$INSTALL_DIR/config.yaml" 2>/dev/null || true
    cp "$KDE_CORE_DIR/README.md" "$INSTALL_DIR/README.md"
    
    # Create MODE.md
    echo "# KDE Mode" > MODE.md
    echo "" >> MODE.md
    if [[ "$MODE" == "MODE_2" ]]; then
        echo "**Current Mode: 2**" >> MODE.md
    else
        echo "**Current Mode: 1**" >> MODE.md
    fi
    
    log_info "Files installed ✓"
}

update_gitignore() {
    if [[ -f ".gitignore" ]] && [[ "$SKIP_GIT" != "true" ]]; then
        if ! grep -q "^kde-core/" .gitignore 2>/dev/null; then
            log_info "Updating .gitignore..."
            echo "" >> .gitignore
            echo "# kde-core" >> .gitignore
            echo "kde-core/" >> .gitignore
            echo ".kde/" >> .gitignore
            log_info ".gitignore updated ✓"
        fi
    fi
}

create_config() {
    log_info "Creating configuration..."
    
    mkdir -p .kde
    cat > .kde/config.yaml << EOF
# kde-core Configuration
version: "${KDE_CORE_VERSION}"
mode: "${MODE}"
installed: $(date -u +%Y-%m-%dT%H:%M:%SZ)
repository: $(git remote get-url origin 2>/dev/null || echo "unknown")
EOF
    
    log_info "Configuration created ✓"
}

run_preflight() {
    log_info "Running pre-flight check..."
    echo ""
    
    if python3 "$INSTALL_DIR/runtime/preflight.py"; then
        log_info "Pre-flight check passed ✓"
    else
        log_warn "Pre-flight check reported issues. Review above."
    fi
}

show_next_steps() {
    cat << EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

kde-core v${KDE_CORE_VERSION} installed successfully!

Mode: ${MODE}

Next steps:
  1. Review configuration: cat .kde/config.yaml
  2. Customize: nano kde-core/config.yaml
  3. Run pre-flight anytime: python3 kde-core/runtime/preflight.py

Documentation: kde-core/README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -m|--mode)
            MODE="$2"
            shift 2
            ;;
        -d|--dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        -n|--no-git)
            SKIP_GIT="true"
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate mode
if [[ "$MODE" != "MODE_1" ]] && [[ "$MODE" != "MODE_2" ]]; then
    log_error "Invalid mode: $MODE. Use MODE_1 or MODE_2."
    exit 1
fi

# Main installation
main() {
    log_info "kde-core Installation"
    log_info "Mode: $MODE"
    log_info "Target: $INSTALL_DIR/"
    echo ""
    
    check_requirements
    backup_existing
    install_files
    update_gitignore
    create_config
    run_preflight
    show_next_steps
}

main
