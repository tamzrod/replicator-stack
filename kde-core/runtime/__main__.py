"""
kde-core Runtime Entry Point

Allows running: python3 -m runtime [command]
"""

import sys
import os

# Add kde-core base to path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
KDE_BASE = os.environ.get("KDE_BASE", os.path.dirname(SCRIPT_DIR))
sys.path.insert(0, KDE_BASE)

from runtime.preflight import main

if __name__ == "__main__":
    sys.exit(main())
