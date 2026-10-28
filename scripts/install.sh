#!/bin/sh
set -e

# ==============================================================================
# 80degrees Desktop Installer (macOS & Linux)
# Installs standalone desktop app with zero Apple Developer ID fees & no Gatekeeper blocks.
#
# Usage:
#   curl -fsSL https://get.80degreeslabs.com | sh
#   curl -fsSL https://raw.githubusercontent.com/aniasusual/crbn/main/scripts/install.sh | sh
#
# Options:
#   --ref <version>    Install a specific release tag (e.g. --ref v0.1.3)
# ==============================================================================

REPO="aniasusual/crbn"
APP_NAME="80degrees"
REF=""
TELEMETRY_ENDPOINT="${TELEMETRY_ENDPOINT:-https://get.80degreeslabs.com/api/v1/telemetry}"
INSTALL_START_TIME="$(date +%s 2>/dev/null || echo 0)"
INSTALL_SUCCESS=0
CURRENT_STAGE="init"
CLI_LINKED=0
DEVICE_ID_OVERRIDE=""

get_or_create_device_id() {
  ID_FILE="$HOME/.80degrees/device_id"
  if [ -n "$DEVICE_ID_OVERRIDE" ]; then
    mkdir -p "$HOME/.80degrees" 2>/dev/null || true
    printf "%s" "$DEVICE_ID_OVERRIDE" > "$ID_FILE" 2>/dev/null || true
    printf "%s" "$DEVICE_ID_OVERRIDE"
    return
  fi
  if [ -f "$ID_FILE" ]; then
    EXISTING="$(cat "$ID_FILE" 2>/dev/null)"
    if [ -n "$EXISTING" ]; then
      printf "%s" "$EXISTING"
      return
    fi
  fi
  NEW_ID="$(LC_ALL=C tr -dc 'a-f0-9' </dev/urandom 2>/dev/null | head -c 32 || echo "sh-$(date +%s)")"
  mkdir -p "$HOME/.80degrees" 2>/dev/null || true
  printf "%s" "$NEW_ID" > "$ID_FILE" 2>/dev/null || true
  printf "%s" "$NEW_ID"
}

DEVICE_ID="$(get_or_create_device_id)"

send_telemetry() {
  if [ "$DO_NOT_TRACK" = "1" ] || [ "${_80DEGREES_NO_TELEMETRY:-$NO_TELEMETRY}" = "1" ]; then
    return
  fi
  _EVENT="$1"
  _PROPS="$2"
  (
    _NOW="$(date +%s 2>/dev/null || echo 0)000"
    _PAYLOAD=$(printf '{"device_id":"%s","event":"%s","properties":%s,"timestamp":%s}' \
      "$DEVICE_ID" "$_EVENT" "$_PROPS" "$_NOW")
    curl -s -m 2 -X POST "$TELEMETRY_ENDPOINT" \
      -H "Content-Type: application/json" \
      -d "$_PAYLOAD" >/dev/null 2>&1
  ) &
}
while [ $# -gt 0 ]; do
  case "$1" in
    --ref|-r)
      shift
      if [ -z "$1" ]; then
        echo "Error: Missing value for --ref" >&2
        exit 1
      fi
      REF="$1"
      shift
      ;;
    --ref=*)
      REF="${1#*=}"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# Architecture detection (Rosetta 2 safe on macOS)
detect_arch() {
  if [ "$(uname -s)" = "Darwin" ]; then
    # Check physical hardware capability even if running in translated x86_64 shell
    if [ "$(/usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null || sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then
      echo "arm64"
    else
      echo "x64"
    fi
    return
  fi

  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "$(uname -m)" ;;
  esac
}

OS_TYPE="$(uname -s)"
ARCH="$(detect_arch)"

case "$OS_TYPE" in
  Darwin)
    TARGET_OS="mac"
    EXT="zip"
    ;;
  Linux)
    TARGET_OS="linux"
    EXT="tar.gz"
    ;;
  *)
    echo "Error: Unsupported operating system: $OS_TYPE" >&2
    echo "For Windows, use: irm https://get.80degrees.dev/ps1 | iex" >&2
    exit 1
    ;;
esac

ASSET_FILE="${APP_NAME}-${TARGET_OS}-${ARCH}.${EXT}"

if [ -n "$REF" ]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${REF}/${ASSET_FILE}"
else
  # Direct GitHub CDN redirect URL (completely bypasses GitHub API 60 req/hr rate limits)
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${ASSET_FILE}"
fi
send_telemetry "install_started" "{\"os\":\"$TARGET_OS\",\"arch\":\"$ARCH\",\"ref\":\"$REF\",\"installer\":\"sh\"}"

echo ""
echo "  ⚡ Installing ${APP_NAME} (${TARGET_OS}-${ARCH})..."
echo "  Downloading from GitHub Releases CDN..."
echo ""

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t '80degrees-install')"
cleanup() {
  _EXIT_CODE=$?
  if [ "$INSTALL_SUCCESS" -ne 1 ]; then
    send_telemetry "install_failed" "{\"stage\":\"$CURRENT_STAGE\",\"exit_code\":$_EXIT_CODE,\"os\":\"$TARGET_OS\",\"arch\":\"$ARCH\"}"
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

CURRENT_STAGE="download"
DOWNLOAD_PATH="$TMP_DIR/$ASSET_FILE"
# Download with interactive progress bar
if command -v curl >/dev/null 2>&1; then
  if ! curl -#fSL --connect-timeout 15 --retry 2 "$DOWNLOAD_URL" -o "$DOWNLOAD_PATH"; then
    echo "" >&2
    echo "Error: Failed to download ${ASSET_FILE} from ${DOWNLOAD_URL}" >&2
    exit 1
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -q --show-progress "$DOWNLOAD_URL" -O "$DOWNLOAD_PATH"; then
    echo "" >&2
    echo "Error: Failed to download ${ASSET_FILE} from ${DOWNLOAD_URL}" >&2
    exit 1
  fi
else
  echo "Error: curl or wget is required to install ${APP_NAME}" >&2
  exit 1
fi

EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"

CURRENT_STAGE="extract"
echo ""
echo "  ==> Extracting ${ASSET_FILE}..."
if [ "$TARGET_OS" = "mac" ]; then
  if ! unzip -q "$DOWNLOAD_PATH" -d "$EXTRACT_DIR"; then
    echo "Error: Failed to unzip archive" >&2
    exit 1
  fi

  SOURCE_APP="$EXTRACT_DIR/${APP_NAME}.app"
  if [ ! -d "$SOURCE_APP" ]; then
    # In case the zip had an internal subfolder
    SOURCE_APP=$(find "$EXTRACT_DIR" -name "${APP_NAME}.app" -type d -maxdepth 2 | head -n 1)
  fi

  if [ -z "$SOURCE_APP" ] || [ ! -d "$SOURCE_APP" ]; then
    echo "Error: Could not locate ${APP_NAME}.app in the downloaded package." >&2
    exit 1
  fi
  # ──────────────────────────────────────────────────────────────────────────
  # Crucial for macOS Sequoia / Sonoma:
  # Strip Gatekeeper quarantine recursively BEFORE moving to Applications
  # ──────────────────────────────────────────────────────────────────────────
  echo "  ==> Stripping Gatekeeper quarantine (no Apple developer fee required)..."
  xattr -cr "$SOURCE_APP" 2>/dev/null || true

  # Determine target directory
  TARGET_DIR="/Applications"
  if [ ! -w "$TARGET_DIR" ]; then
    TARGET_DIR="$HOME/Applications"
    mkdir -p "$TARGET_DIR"
  fi

  DEST_APP="$TARGET_DIR/${APP_NAME}.app"

  echo "  ==> Installing to ${DEST_APP}..."
  rm -rf "$DEST_APP" 2>/dev/null || true
  mv "$SOURCE_APP" "$DEST_APP"

  # Final permission and quarantine wipe on destination
  xattr -cr "$DEST_APP" 2>/dev/null || true
  chmod -R u+rwX "$DEST_APP" 2>/dev/null || true
  touch "$DEST_APP" 2>/dev/null || true

  # Create convenient CLI launcher if ~/.local/bin or /usr/local/bin is available
  for bin_dir in "$HOME/.local/bin" "/usr/local/bin"; do
    if [ -d "$bin_dir" ] && [ -w "$bin_dir" ]; then
      cat << 'EOF' > "$bin_dir/80degrees"
#!/bin/sh
if [ $# -eq 0 ]; then
  open -a 80degrees
else
  open -a 80degrees --args "$@"
fi
EOF
      chmod +x "$bin_dir/80degrees" 2>/dev/null && CLI_LINKED=1 || true
      break
    fi
  done

  echo ""
  echo "  ✓ Successfully installed ${APP_NAME} to ${DEST_APP}"
  echo "  ✓ Zero Apple Developer ID warnings. Ready to use immediately!"
  echo "  ✓ Terminal command available: '80degrees [folder]'"
  echo ""
  echo "  ==> Launching ${APP_NAME}..."
  open "$DEST_APP"
elif [ "$TARGET_OS" = "linux" ]; then
  INSTALL_DIR="$HOME/.local/share/${APP_NAME}"
  BIN_DIR="$HOME/.local/bin"
  DESKTOP_DIR="$HOME/.local/share/applications"

  mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$DESKTOP_DIR"

  if ! tar -xzf "$DOWNLOAD_PATH" -C "$INSTALL_DIR"; then
    echo "Error: Failed to extract tarball" >&2
    exit 1
  fi

  EXE_PATH="$INSTALL_DIR/${APP_NAME}"
  if [ -f "$EXE_PATH" ]; then
    chmod +x "$EXE_PATH"
    ln -sf "$EXE_PATH" "$BIN_DIR/${APP_NAME}" && CLI_LINKED=1 || true
  fi

  # Create desktop entry
  cat <<EOF > "$DESKTOP_DIR/${APP_NAME}.desktop"
[Desktop Entry]
Name=${APP_NAME}
Comment=AI-powered autonomous software engineering environment
Exec=${BIN_DIR}/${APP_NAME} %U
Terminal=false
Type=Application
Categories=Development;IDE;
EOF
  chmod +x "$DESKTOP_DIR/${APP_NAME}.desktop" 2>/dev/null || true

  echo ""
  echo "  ✓ Successfully installed ${APP_NAME} to ${INSTALL_DIR}"
  echo "  ✓ Created launcher shortcut at ${BIN_DIR}/${APP_NAME}"
  echo ""

  if [ -x "$EXE_PATH" ]; then
    echo "  ==> Launching ${APP_NAME}..."
    nohup "$EXE_PATH" >/dev/null 2>&1 &
  fi
fi

INSTALL_SUCCESS=1
_END_TIME="$(date +%s 2>/dev/null || echo 0)"
_DURATION=$(( _END_TIME - INSTALL_START_TIME ))
send_telemetry "install_completed" "{\"os\":\"$TARGET_OS\",\"arch\":\"$ARCH\",\"duration_sec\":$_DURATION,\"cli_linked\":$CLI_LINKED}"

echo ""
