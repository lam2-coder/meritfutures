#!/usr/bin/env bash
# =============================================================================
# scripts/ci/install-pinned-tool.sh
# =============================================================================
# Install one CI-05 scanner from its GitHub release, at a version this
# repository pins, and REPORT ENOUGH ON FAILURE THAT THE FIX IS ONE EDIT.
#
#   install-pinned-tool.sh <owner/repo> <version> <asset-template> <binary>
#
#   install-pinned-tool.sh gitleaks/gitleaks 8.28.0 \
#     'gitleaks_{v}_linux_x64.tar.gz' gitleaks
#
# `{v}` in the template is replaced by the version. The tag is `v<version>`,
# which is the convention all three of these projects use.
#
# -----------------------------------------------------------------------------
# WHY A SCRIPT AND NOT THREE `curl | tar` LINES IN THE WORKFLOW
# -----------------------------------------------------------------------------
# A pinned version is a number that goes stale, and the failure mode of a stale
# pin is a 404 from a URL with the version buried in it. Three copies of that
# would be three places to read a 404 and guess. This resolves the CURRENT
# upstream tag on failure and prints it, so a version bump is one edit informed
# by the error rather than a bisect against a release page.
#
# -----------------------------------------------------------------------------
# THE DIGEST, AND WHY IT IS OPTIONAL AND LOUD
# -----------------------------------------------------------------------------
# A version pin says WHICH release; a digest says which BYTES. Only the second
# survives a re-tagged or replaced release asset, which is the supply-chain
# failure VG-12 is about, applied to the scanners rather than to the
# dependencies they scan.
#
# The observed sha256 is always printed. When a fifth argument is supplied it is
# ENFORCED and a mismatch aborts. When it is not, the script says so in the log
# rather than letting an unpinned digest look identical to a pinned one.

set -euo pipefail

repo="${1:?owner/repo}"
version="${2:?version, without the leading v}"
template="${3:?asset name template, with {v} for the version}"
binary="${4:?the binary the archive contains}"
expected_sha="${5:-}"

bindir="${BINDIR:-/usr/local/bin}"
asset="${template//\{v\}/$version}"
url="https://github.com/${repo}/releases/download/v${version}/${asset}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> ${repo} v${version}"
echo "    ${url}"

if ! curl -fsSL --retry 3 --retry-delay 2 -o "${work}/${asset}" "${url}"; then
  echo "::error::${repo} v${version} did not download. The pin is stale or the asset name changed."
  echo "    asset requested: ${asset}"
  # api.github.com is the primary source for what the pin SHOULD be. If this
  # also fails there is a network problem rather than a stale pin, and the
  # message says which.
  if latest="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" 2>/dev/null)"; then
    tag="$(printf '%s' "$latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
    echo "::error::upstream currently publishes ${tag}. Pin that version in .github/workflows/ci.yml."
    echo "    assets on that release:"
    printf '%s' "$latest" | sed -n 's/.*"name": *"\([^"]*\.tar\.gz\)".*/      \1/p' | sort -u
  else
    echo "::error::could not reach the GitHub release API either, so this is not a stale pin."
  fi
  exit 1
fi

observed_sha="$(sha256sum "${work}/${asset}" | cut -d' ' -f1)"
echo "    sha256 ${observed_sha}"

if [ -n "$expected_sha" ]; then
  if [ "$observed_sha" != "$expected_sha" ]; then
    echo "::error::${asset} sha256 mismatch. Expected ${expected_sha}, got ${observed_sha}."
    echo "::error::A release asset whose bytes changed under a fixed tag is the supply-chain event VG-12 is about. Do not bump the digest to make this pass without establishing why it moved."
    exit 1
  fi
  echo "    digest verified against the pin"
else
  echo "::warning::${repo} is pinned by VERSION and not by DIGEST. Add the sha256 above as the fifth argument to pin the bytes."
fi

tar -xzf "${work}/${asset}" -C "$work" "$binary"
install -m 0755 "${work}/${binary}" "${bindir}/${binary}"
echo "    installed $("${bindir}/${binary}" --version 2>&1 | head -1)"
