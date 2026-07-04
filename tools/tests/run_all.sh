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
node harness.js wp10-tests.js
node test_wp1.js
node test_wp6.js
node test_wp7.js
node test_wp8.js
echo "ALL SUITES PASSED"
