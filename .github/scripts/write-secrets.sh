#!/usr/bin/env bash
# wrangler の --secrets-file に渡す、シークレットのファイル（NAME=value の行）を作る。
#
# 使い方:
#   write-secrets.sh <出力先のファイル> [--required NAME]... [--optional NAME]...
#
#   --required NAME  環境変数 NAME の値を書く。空なら、エラーにして止まる（デプロイを止める）
#   --optional NAME  環境変数 NAME の値を書く。空なら、書かない（未登録の秘密は、渡さない）
#
# エラーは、GitHub Actions の「::error::」の形で、標準出力に出す（画面に、注釈として出る）。
# 値は、コマンドの引数ではなく、環境変数から読む（プロセスの一覧や、ログに、値が出ないようにするため）。
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "使い方: write-secrets.sh <出力先のファイル> [--required NAME]... [--optional NAME]..." >&2
  exit 2
fi

output="$1"
shift

# 他のユーザーに読まれないようにして、空のファイルを作る
umask 077
: > "$output"

while [ "$#" -gt 0 ]; do
  mode="$1"
  name="${2:-}"
  if [ -z "$name" ]; then
    echo "::error::${mode} に、名前がありません"
    exit 2
  fi
  shift 2

  value="${!name:-}"
  case "$mode" in
    --required)
      if [ -z "$value" ]; then
        echo "::error::${name} が、この環境の Secrets に登録されていません"
        exit 1
      fi
      printf '%s=%s\n' "$name" "$value" >> "$output"
      ;;
    --optional)
      if [ -n "$value" ]; then
        printf '%s=%s\n' "$name" "$value" >> "$output"
      fi
      ;;
    *)
      echo "::error::知らないオプションです: ${mode}"
      exit 2
      ;;
  esac
done
