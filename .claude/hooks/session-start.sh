#!/bin/bash
# Claude Code のクラウドセッション開始時に、dotnet test を動かせるようにする。
# dot.net のインストールスクリプトはネットワークの制限で取れないため、
# packages.microsoft.com の apt から .NET SDK 10.0 を入れる（global.json は 10.0.x）。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

if ! dotnet --list-sdks 2>/dev/null | grep -q '^10\.0\.'; then
  if [ ! -f /etc/apt/sources.list.d/microsoft-prod.list ]; then
    . /etc/os-release
    deb="$(mktemp --suffix=.deb)"
    curl -sSL "https://packages.microsoft.com/config/${ID}/${VERSION_ID}/packages-microsoft-prod.deb" -o "$deb"
    $SUDO dpkg -i "$deb" >/dev/null
    rm -f "$deb"
  fi
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq dotnet-sdk-10.0 >/dev/null
fi

export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1
echo 'export DOTNET_CLI_TELEMETRY_OPTOUT=1' >> "$CLAUDE_ENV_FILE"
echo 'export DOTNET_NOLOGO=1' >> "$CLAUDE_ENV_FILE"

dotnet restore "$CLAUDE_PROJECT_DIR/tests/FaraSiteKit.Core.Tests" >/dev/null
