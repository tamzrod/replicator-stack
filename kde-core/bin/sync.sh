#!/usr/bin/env bash
# kde-core Sync Script
# Updates kde-core with latest changes from main repository

set -e

# Configuration
KDE_CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
AUTO_COMMIT="${AUTO_COMMIT:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_step() {
    echo -e "${BLUE}[SYNC]${NC} $1"
}

usage() {
    cat << EOF
Usage: sync.sh [OPTIONS]

Sync kde-core with the latest changes from main repository.

OPTIONS:
    -r, --remote REMOTE    Remote name (default: origin)
    -b, --branch BRANCH    Branch name (default: main)
    -a, --auto-commit      Automatically commit changes
    -d, --dry-run          Show what would be synced without making changes
    -f, --force            Force sync even if working directory is dirty
    -h, --help             Show this help message

EXAMPLES:
    ./sync.sh                        # Sync with defaults
    ./sync.sh --dry-run              # Preview changes
    ./sync.sh --auto-commit         # Sync and commit
    ./sync.sh --remote upstream      # Sync from upstream

EOF
}

check_git() {
    log_info "Checking git repository..."
    
    if ! command -v git &> /dev/null; then
        log_error "git is required but not installed."
        exit 1
    fi
    
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository."
        exit 1
    fi
    
    # Check if kde-core is a git submodule or subdirectory
    if [[ -d "$KDE_CORE_DIR/.git" ]]; then
        log_info "kde-core is a separate git repository"
        IN_KDE_CORE=true
    else
        log_info "kde-core is part of main repository"
        IN_KDE_CORE=false
    fi
}

check_remote() {
    log_info "Checking remote: $REMOTE..."
    
    if ! git remote get-url "$REMOTE" &> /dev/null 2>&1; then
        log_error "Remote '$REMOTE' not found."
        log_info "Available remotes:"
        git remote -v
        exit 1
    fi
    
    local remote_url=$(git remote get-url "$REMOTE")
    log_info "Remote URL: $remote_url"
}

fetch_latest() {
    log_step "Fetching latest changes from $REMOTE/$BRANCH..."
    
    if ! git fetch "$REMOTE" "$BRANCH" 2>&1; then
        log_error "Failed to fetch from $REMOTE/$BRANCH"
        log_info "Trying to fetch all..."
        git fetch --all 2>&1 || true
    fi
    
    # Check if branch exists
    if git rev-parse "$REMOTE/$BRANCH" > /dev/null 2>&1; then
        local latest_hash=$(git rev-parse "$REMOTE/$BRANCH")
        local current_hash=$(git rev-parse HEAD 2>/dev/null || echo "")
        
        log_info "Latest commit: $(git log -1 --oneline "$REMOTE/$BRANCH" 2>/dev/null || echo "unknown")"
        
        if [[ "$latest_hash" == "$current_hash" ]]; then
            log_info "Already up to date ✓"
            return 0
        fi
    fi
}

check_status() {
    log_step "Checking working directory status..."
    
    if git status --porcelain | grep -q .; then
        if [[ "$FORCE" != "true" ]]; then
            log_warn "Working directory has uncommitted changes."
            git status --short
            echo ""
            log_info "Use --force to sync anyway, or commit your changes first."
            exit 1
        else
            log_warn "Force sync with uncommitted changes..."
        fi
    else
        log_info "Working directory clean ✓"
    fi
}

sync_files() {
    log_step "Syncing kde-core files..."
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY RUN - Would sync the following kde-core directories:"
        echo ""
        git diff "$REMOTE/$BRANCH" --name-only HEAD -- kde-core/ 2>/dev/null | head -20 || true
        echo ""
        if git diff "$REMOTE/$BRANCH" --stat HEAD -- kde-core/ 2>/dev/null | tail -1; then
            :
        fi
        log_info "DRY RUN complete. Run without --dry-run to apply changes."
        return 0
    fi
    
    # Get list of changed files in kde-core
    local changed_files=$(git diff "$REMOTE/$BRANCH" HEAD --name-only -- kde-core/ 2>/dev/null | wc -l)
    
    if [[ "$changed_files" == "0" ]]; then
        log_info "No changes in kde-core to sync ✓"
        return 0
    fi
    
    log_info "Found $changed_files changed file(s) in kde-core/"
    
    # Create backup
    local backup_name=".kde-sync-backup-$(date +%Y%m%d-%H%M%S)"
    log_info "Creating backup in $backup_name/"
    mkdir -p "$backup_name"
    
    # Backup current kde-core state
    cp -r kde-core "$backup_name/" 2>/dev/null || true
    
    # Perform merge/sync
    log_step "Merging changes..."
    
    if git merge "$REMOTE/$BRANCH" -m "Sync: kde-core update from $REMOTE/$BRANCH" --no-edit 2>&1; then
        log_info "Merge successful ✓"
    else
        log_warn "Merge conflicts detected."
        log_info "Please resolve conflicts manually and commit."
        log_info "Backup available at: $backup_name/"
        
        # Abort merge to leave clean state
        git merge --abort 2>/dev/null || true
        
        exit 1
    fi
}

show_summary() {
    log_step "Sync Summary"
    echo ""
    
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "DRY RUN - No changes applied"
    else
        echo "Sync completed successfully!"
    fi
    
    echo ""
    echo "Remote:        $REMOTE/$BRANCH"
    echo "Latest commit: $(git log -1 --oneline "$REMOTE/$BRANCH" 2>/dev/null || echo 'unknown')"
    
    if [[ "$AUTO_COMMIT" == "true" ]]; then
        echo "Commit:        $(git log -1 --oneline HEAD)"
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Next steps:"
    echo "  1. Review changes:   git diff HEAD~1 --stat"
    echo "  2. Run preflight:    python3 kde-core/runtime/preflight.py"
    echo "  3. Test kde-core:    python3 kde-core/runtime/preflight.py"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -r|--remote)
            REMOTE="$2"
            shift 2
            ;;
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        -a|--auto-commit)
            AUTO_COMMIT="true"
            shift
            ;;
        -d|--dry-run)
            DRY_RUN="true"
            shift
            ;;
        -f|--force)
            FORCE="true"
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

# Main sync process
main() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "                 kde-core Sync"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    check_git
    check_remote
    fetch_latest
    check_status
    sync_files
    show_summary
}

main
