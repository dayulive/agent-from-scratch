#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
report_file="$(mktemp)"
server_log="$(mktemp)"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$report_file" "$server_log"
}
trap cleanup EXIT

npm run cli -- --help >/dev/null
npm run evaluate -- --offline >"$report_file"
node -e 'const fs=require("node:fs"); const text=fs.readFileSync(process.argv[1],"utf8"); const report=JSON.parse(text.slice(text.indexOf("{"))); if(report.passedCases!==30) process.exit(1); console.log(`离线评测：${report.passedCases}/${report.totalCases}`);' "$report_file"
npm run build >/dev/null

PORT=4310 HOST=127.0.0.1 OPENAI_API_KEY= ANTHROPIC_API_KEY= node dist/server/index.js >"$server_log" 2>&1 &
server_pid=$!
healthy=false
for _ in $(seq 1 50); do
  if node -e 'fetch("http://127.0.0.1:4310/health").then(async r=>{const body=await r.json();if(!r.ok||body.status!=="ok")process.exit(1)}).catch(()=>process.exit(1))' 2>/dev/null; then
    healthy=true
    break
  fi
  sleep 0.1
done
if [[ "$healthy" != "true" ]]; then
  echo "健康检查失败" >&2
  exit 1
fi

echo "烟雾验证通过：CLI、离线评测、构建、HTTP 健康检查"
