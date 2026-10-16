#!/usr/bin/env bash
# ---------------------------------------------------------------
# git-sync.sh —— 对话结束时自动提交并推送
#
# 由 .codebuddy/settings.json 的 Stop / SessionEnd 钩子自动调用，
# 也可手动运行：bash scripts/git-sync.sh
#
# 行为：
#   1. 无改动            -> 直接跳过（不产生空提交）
#   2. 有改动            -> git add -A + 规范提交
#   3. 已配置远程仓库     -> 推送；推送失败不影响对话结束
#   4. 未配置远程仓库     -> 仅本地提交，并给出配置提示
# ---------------------------------------------------------------
set -uo pipefail

REPO="${CODEBUDDY_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-/workspace}}"
cd "$REPO" || exit 0

log()  { printf '[git-sync] %s\n' "$*"; }
warn() { printf '[git-sync] %s\n' "$*" >&2; }

# 1. 仓库检查
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  warn "当前目录不是 git 仓库，跳过同步"
  exit 0
fi

# 2. 兜底身份配置（首次使用未设置 user 时不会提交失败）
if ! git config user.email >/dev/null 2>&1; then
  git config user.email "workbuddy@agent.local"
  git config user.name "WorkBuddy Agent"
fi

# 3. 暂存全部改动
git add -A

# 4. 无改动则跳过
if git diff --cached --quiet; then
  log "无文件变更，跳过提交"
  exit 0
fi

# 5. 生成提交信息
TS="$(date '+%Y-%m-%d %H:%M:%S')"
SHORTSTAT="$(git diff --cached --shortstat)"
SUMMARY="$(git diff --cached --name-status | while IFS=$'\t' read -r st path newpath; do
  case "${st:0:1}" in
    A) act="新增" ;;
    M) act="修改" ;;
    D) act="删除" ;;
    R) act="重命名" ;;
    *) act="变更" ;;
  esac
  if [ "${st:0:1}" = "R" ] && [ -n "${newpath:-}" ]; then
    echo "- ${act} ${path} -> ${newpath}"
  else
    echo "- ${act} ${path}"
  fi
done | head -20)"

COUNT="$(git diff --cached --name-only | wc -l | tr -d ' ')"
if [ "$COUNT" -gt 20 ]; then
  SUMMARY="${SUMMARY}"$'\n'"- ...等共 ${COUNT} 个文件"
fi

MSG="$(printf 'chore: 自动提交 %s\n\n%s\n\n%s' "$TS" "$SHORTSTAT" "$SUMMARY")"

if ! git commit -q -m "$MSG"; then
  warn "提交失败，请检查 git 配置"
  exit 0
fi

BRANCH="$(git branch --show-current 2>/dev/null || echo main)"
log "已提交 $(git rev-parse --short HEAD) -> ${BRANCH}（${COUNT} 个文件）"

# 6. 推送（有远程才推）
REMOTE="$(git remote | head -1)"
if [ -n "$REMOTE" ]; then
  if git push "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    log "已推送到 ${REMOTE}/${BRANCH}"
  else
    warn "推送到 ${REMOTE} 失败（改动已安全保存在本地提交，可稍后重试：git push）"
  fi
else
  warn "未配置远程仓库，仅本地提交。配置：bash scripts/git-remote.sh <仓库URL>"
fi

exit 0
