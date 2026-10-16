#!/usr/bin/env bash
# ---------------------------------------------------------------
# git-remote.sh —— 配置 / 更换远程仓库地址并首次推送
#
# 用法：
#   bash scripts/git-remote.sh git@github.com:<用户名>/<仓库>.git
#   bash scripts/git-remote.sh https://github.com/<用户名>/<仓库>.git
#   bash scripts/git-remote.sh                 # 查看当前远程
# 可选环境变量：
#   REMOTE_NAME=origin  远程仓库名（默认 origin）
# ---------------------------------------------------------------
set -uo pipefail

REPO="${CODEBUDDY_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-/workspace}}"
cd "$REPO" || exit 1
REMOTE_NAME="${REMOTE_NAME:-origin}"
URL="${1:-}"

if [ -z "$URL" ]; then
  echo "当前远程仓库："
  git remote -v || echo "（未配置任何远程）"
  echo
  echo "配置方法：bash scripts/git-remote.sh <仓库URL>"
  exit 0
fi

# 新增或更新远程地址
if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  git remote set-url "$REMOTE_NAME" "$URL"
  echo "已更新 ${REMOTE_NAME} -> ${URL}"
else
  git remote add "$REMOTE_NAME" "$URL"
  echo "已添加 ${REMOTE_NAME} -> ${URL}"
fi

BRANCH="$(git branch --show-current 2>/dev/null || echo main)"

# 首次推送并设置上游分支
if git push -u "$REMOTE_NAME" "$BRANCH"; then
  echo "已推送 ${BRANCH} 到 ${REMOTE_NAME}，后续同步将自动推送"
else
  echo "推送失败，请检查："
  echo "  1. 仓库地址是否正确、远程仓库是否已创建"
  echo "  2. 认证是否可用（SSH key 或 access token）"
  echo "  3. 网络是否可达"
  echo "手动重试：git push -u ${REMOTE_NAME} ${BRANCH}"
  exit 1
fi
