#!/bin/sh
# SessionStart: puts the Node version of .nvmrc first on the PATH of every
# command the session runs, when the default one is another major (npm refuses
# Node 25, see CONTRIBUTING.md). Without an installed match, nothing changes.
[ -n "$CLAUDE_ENV_FILE" ] || exit 0
want=$(tr -d ' v\n' < "${CLAUDE_PROJECT_DIR:-.}/.nvmrc") || exit 0
case "$(node -v 2>/dev/null)" in "v$want".*) exit 0 ;; esac

# The newest install of that major: nvm, fnm, then Homebrew's node@<major>.
bin=$(
  {
    ls -d "${NVM_DIR:-$HOME/.nvm}/versions/node/v$want".*/bin
    ls -d "${FNM_DIR:-$HOME/.local/share/fnm}/node-versions/v$want".*/installation/bin
    ls -d "$HOME/Library/Application Support/fnm/node-versions/v$want".*/installation/bin
    ls -d "/opt/homebrew/opt/node@$want/bin" "/usr/local/opt/node@$want/bin"
  } 2>/dev/null | sort -V | tail -n 1
)
[ -n "$bin" ] || exit 0
printf 'export PATH="%s:$PATH"\n' "$bin" >> "$CLAUDE_ENV_FILE"
