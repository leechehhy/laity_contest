#!/bin/bash
# macOS / Linux 실행 스크립트
cd "$(dirname "$0")"

echo ""
echo "  ============================================================"
echo "   제1회 광주대학교 L'AI'TY 경진대회 신청 사이트"
echo "  ============================================================"
echo ""

NODE=""
if [ -x "./node/bin/node" ]; then NODE="./node/bin/node"
elif command -v node > /dev/null 2>&1; then NODE="node"
fi

if [ -z "$NODE" ]; then
  echo "  [!] 이 컴퓨터에 Node.js 가 없습니다."
  echo "      https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  echo ""
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
  exit 1
fi

echo "  서버를 시작합니다. 잠시 후 브라우저가 자동으로 열립니다."
echo "  [중요] 이 창을 닫으면 사이트가 중지됩니다."
echo ""

(sleep 3 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null)) &
"$NODE" server.js

echo ""
read -n 1 -s -r -p "  서버가 종료되었습니다. 아무 키나 누르면 닫힙니다."
