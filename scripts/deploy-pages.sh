#!/usr/bin/env bash
# 把构建产物发布到 gh-pages 分支。
#
# 注意：本仓库的 GitHub Pages 源配置为「从分支部署（gh-pages）」，
# 所以不能用 actions/deploy-pages（它要求 Pages 源为 GitHub Actions，
# 否则 deploy job 必然失败）。这里统一走「构建 → 覆盖 gh-pages 分支」。
#
# 用法：bash scripts/deploy-pages.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$REPO_ROOT"
echo '==> 构建'
pnpm build

ORIGIN="$(git remote get-url origin)"
SHORT="$(git rev-parse --short HEAD)"

echo '==> 克隆 gh-pages 分支'
git clone -q --branch gh-pages --single-branch "$ORIGIN" "$WORK/ghp"

cd "$WORK/ghp"
# 清空旧产物（保留 .git）
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

cp -R "$REPO_ROOT/dist/." .
touch .nojekyll

git add -A
if git diff --cached --quiet; then
  echo '==> 产物无变化，跳过提交'
  exit 0
fi

git -c user.name='deploy bot' -c user.email='bot@localhost' \
  commit -q -m "chore: 部署构建产物到 gh-pages（main @ ${SHORT}）"

git push -q origin gh-pages
echo "==> 已推送 gh-pages（main @ ${SHORT}），稍等 1-2 分钟生效"
