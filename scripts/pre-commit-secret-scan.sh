#!/usr/bin/env bash
# Wordaydream v1.5.1 Stage 1 P0_2: Pre-commit secret scan
#
# 4 阻塞点 runbook 之一 (阻塞点 2: 3 API key 真实配置)
#   docs/OPERATIONS.md Section 2 包含 15 步骤 runbook.
#
# 防止 API key 误入代码:
#   - OPENAI_API_KEY: sk-... / sk-proj-...
#   - ANTHROPIC_API_KEY: sk-ant-...
#   - DEEPSEEK_API_KEY: sk-... (与 openai 同样前缀, 用文件名辅助区分)
#
# 扫描范围: git diff --cached (staged files)
# 命中模式: sk- / sk-ant- / sk-proj- + 至少 20 字符 (避免误报短词)
# 退出: 命中 exit 1, 阻断 commit
#
# 安装 (推荐): 项目根目录 .git/hooks/pre-commit
#   ln -s ../../scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit
# 或手动: cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit
#
# 0 emoji (硬约束)

set -euo pipefail

echo "[pre-commit-secret-scan] Scanning staged files for API key patterns..."

# v1.5.1 强化: 3 provider 模式
# 1. sk- 通用前缀 (OpenAI / DeepSeek 共用, sk- 开头 + 至少 20 字符)
# 2. sk-ant- Anthropic 专用 (sk-ant-api03-...)
# 3. sk-proj- OpenAI project-scoped 专用 (sk-proj-xxxx)
PATTERNS=(
  "sk-[a-zA-Z0-9_-]{20,}"           # OpenAI / DeepSeek
  "sk-ant-[a-zA-Z0-9_-]{20,}"       # Anthropic
  "sk-proj-[a-zA-Z0-9_-]{20,}"      # OpenAI project-scoped
)

# 1. 扫描 git diff --cached
STAGED_DIFF=$(git diff --cached --diff-filter=ACMR --no-color)

# 2. 扫描 staged files 全文 (避免 diff 上下文不全)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

HIT=0
for PATTERN in "${PATTERNS[@]}"; do
  # 2a. diff 扫描
  if echo "$STAGED_DIFF" | grep -E -n "$PATTERN" >/dev/null 2>&1; then
    echo "[FAIL] Found '$PATTERN' in staged diff:"
    echo "$STAGED_DIFF" | grep -E -n "$PATTERN" | head -3
    HIT=1
  fi

  # 2b. 文件全文扫描 (更严格, 避免 diff 跨行漏检)
  for FILE in $STAGED_FILES; do
    if [ -f "$FILE" ]; then
      # 跳过二进制文件 / node_modules / dist / .git
      case "$FILE" in
        *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.pdf|*.zip|*.tar|*.gz) continue ;;
        node_modules/*|dist/*|.git/*) continue ;;
      esac
      if grep -E -l "$PATTERN" "$FILE" >/dev/null 2>&1; then
        echo "[FAIL] Found '$PATTERN' in file: $FILE"
        grep -E -n "$PATTERN" "$FILE" | head -3
        HIT=1
      fi
    fi
  done
done

if [ "$HIT" -eq 1 ]; then
  echo ""
  echo "[pre-commit-secret-scan] COMMIT BLOCKED. Possible API key in staged files."
  echo "  Fix:"
  echo "    1. Remove the key from the file"
  echo "    2. If key is real, revoke it immediately at the provider dashboard"
  echo "    3. Use Netlify env / GitHub Secrets to inject the real key"
  echo "  Skip this hook (NOT recommended): git commit --no-verify"
  exit 1
fi

echo "[pre-commit-secret-scan] OK (0 hit, commit allowed)"
exit 0
