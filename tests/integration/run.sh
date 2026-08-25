#!/usr/bin/env bash
# Integration test: run the real RunServer against the real project dir using
# the native Node ESM loader (not vite-node). This is the test layer that
# vitest cannot cover because vite-node mishandles dynamic imports whose
# target paths contain URL-unsafe characters (e.g. our workspace `03_受控安装`).
set -euo pipefail
cd "$(dirname "$0")/../.."
export RUNSERVER_QUIET=1

echo "## integration: list"
node src/cli.mjs list
echo
echo "## integration: scan"
node src/cli.mjs scan
echo
echo "## integration: info"
node src/cli.mjs info
echo
echo "## integration: registry env override"
TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT
cp src/projects/deepseek-harness.mjs "$TMPDIR/"
RUNSERVER_PROJECTS_DIR="$TMPDIR" node -e '
  import("./src/registry.mjs").then(async (r) => {
    const p = await r.listProjects({ fresh: true });
    console.log("env override loaded:", p.map(x => x.id).join(","));
  });
'
echo
echo "## integration: discover without DIR arg (v0.5.2: must fail with exit 2)"
set +e
node src/cli.mjs discover > /tmp/runserver-discover-noarg.out 2> /tmp/runserver-discover-noarg.err
rc=$?
set -e
if [ "$rc" -ne 2 ]; then
  echo "FAIL: discover with no arg should exit 2, got $rc" >&2
  cat /tmp/runserver-discover-noarg.err >&2
  exit 1
fi
if ! grep -q "missing required argument DIR" /tmp/runserver-discover-noarg.err; then
  echo "FAIL: discover stderr should mention 'missing required argument DIR'" >&2
  cat /tmp/runserver-discover-noarg.err >&2
  exit 1
fi
echo "  (exit 2, stderr mentions missing DIR ✓)"

echo
echo "## integration: all tests pass"
