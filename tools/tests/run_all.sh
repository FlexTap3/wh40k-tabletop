#!/bin/sh
# Regression suite: run every WP's node tests against ../../wh40k-tabletop.html.
# harness.js loads the HTML directly; test_wp1/6/8 need app.js extracted first.
cd "$(dirname "$0")"
python3 - <<'PY'
import re
h=open("../../wh40k-tabletop.html").read()
open("app.js","w").write(re.findall(r'<script>(.*?)</script>',h,re.S)[-1])
PY
set -e
node ../test_geometry.js
node harness.js wp2-tests.js
node harness.js wp3-tests.js
node harness.js wp5-tests.js
node harness.js sec-tests.js
node harness.js wp10-tests.js
node harness.js wp11-tests.js
node harness.js wp12-tests.js
node harness.js wp13-tests.js
node harness.js wp14-tests.js
node harness.js wp15-tests.js
node harness.js wp16-tests.js
node harness.js wp17-tests.js
node harness.js wp20-tests.js
node harness.js wp19-tests.js
node harness.js wp18-tests.js
node harness.js wp23-tests.js
node harness.js wp21-tests.js
node harness.js wp22-tests.js
node harness.js wpimport-tests.js
node harness.js import-pts-tests.js
node test_wp1.js
node test_wp6.js
node test_wp7.js
node test_wp8.js
node harness.js wpmove-tests.js
node harness.js wpfight-tests.js
node harness.js wprules-tests.js
node harness.js wpwave2-tests.js
node harness.js meta-refresh-probe.js
node deploy-coherency-test.js
node ai-move-coherency-test.js
node harness.js wp3d-bridge-tests.js
# ==== WP3D ==== section suites are plain-node ES-module tests (no harness/DOM):
node wp3d-1-geometry-tests.js
node wp3d-2-renderer-tests.js
node wp3d-3-labels-tests.js
node wp3d-4-interaction-tests.js
node wp3d-7-troops-tests.js
echo "ALL SUITES PASSED"
