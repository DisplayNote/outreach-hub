#!/usr/bin/env bash
# Loads a dotenv file into the environment WITHOUT executing it as shell code.
#
# Unlike `set -a; . ./.env.local`, this never sources the file, so values are
# never expanded or interpreted by the shell. Secrets containing `$`, backticks,
# spaces, `#`, or other metacharacters are exported verbatim instead of being
# expanded, executed, or truncated.
#
# Supports `KEY=value`, `export KEY=value`, blank lines, `#` comment lines, and
# one layer of matching surrounding single/double quotes around the value.
load_dotenv() {
  local file="$1"
  [ -f "$file" ] || return 0

  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading whitespace.
    line="${line#"${line%%[![:space:]]*}"}"
    # Skip blank lines and full-line comments.
    [ -z "$line" ] && continue
    [ "${line:0:1}" = "#" ] && continue
    # Drop an optional leading `export `.
    line="${line#export }"
    # Require a KEY=VALUE shape; ignore anything else.
    [ "$line" = "${line#*=}" ] && continue

    key="${line%%=*}"
    value="${line#*=}"
    # Trim trailing whitespace from the key (handles `KEY = value`).
    key="${key%"${key##*[![:space:]]}"}"
    # Skip if the key is not a valid shell identifier.
    case "$key" in
      [!A-Za-z_]* | *[!A-Za-z0-9_]*) continue ;;
    esac

    # Strip one layer of matching surrounding quotes, if present.
    if [ ${#value} -ge 2 ] && [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
      value="${value:1:${#value}-2}"
    elif [ ${#value} -ge 2 ] && [ "${value:0:1}" = "'" ] && [ "${value: -1}" = "'" ]; then
      value="${value:1:${#value}-2}"
    fi

    export "$key=$value"
  done < "$file"
}
