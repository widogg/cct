# cct — Claude Code conversation tree

Git-like branches, **and merges**, for Claude Code conversations.

cct is not a multiplexer: it is a conversation manager. It doesn't arrange terminals, panes or
sessions; your window manager already does that. It keeps track of the conversations inside them,
and lets a finished branch merge back into its parent, carrying its context with it.

It ships as two parts that share the same state. The CLI works on its own; the plugin builds on it:

- **A CLI, `cct`** (`bin/cct`): a bash script with an fzf picker to browse, resume, fork, rename,
  merge and drop conversations from any terminal, plus the statusline breadcrumb.
- **A Claude Code plugin, `cct-threads`** (`cct-threads/`): the same tree inside Claude Code, with
  `/threads`, `/merge [drop]` and a band, so you can merge and jump without leaving the session.
  It calls the CLI, so it needs `cct` on your `PATH`.

## Why

Ever since `/branch` and `/fork` arrived, I've been using conversations the way I use git. It
works, except for one detail: there is no `/merge`.

My workflow is several terminal windows across several desktop workspaces. With that many
terminals and that many branched conversations, I kept losing track of which branch I was in,
what it was about, and whether it was done. Branches were opened and never closed.

cct adds the missing half:

- **A tree per repo.** Sub-conversations made with `/branch`, or with `^f` in the picker, form a
  tree you can see and jump around.
- **One terminal per root.** Root conversations live in their own terminals; their
  sub-conversations are traversed in the same terminal, with a breadcrumb showing where you are.
- **Merge.** Closing a branch writes a summary (outcome, decisions, files, open items) into the
  receiving conversation, which gets it as context on its next prompt. A branch can also be
  **dropped**, recording why it was abandoned.
- **Nothing in your repos.** cct reads `~/.claude/projects` and writes only `~/.claude/threads`.

## Requirements

`bash`, `jq`, `fzf` ≥ 0.74, `claude`; `cct` checks for them on start. Optional: `oh-my-posh`.

## Install

Link, don't copy, so this repo stays the source of truth:

```sh
# CLI: any directory on your PATH
ln -s ~/src/cct/bin/cct ~/bin/cct

# Claude Code plugin: the repo is its own marketplace
claude plugin marketplace add ~/src/cct
claude plugin install cct-threads@cct
```

Statusline breadcrumb: set `"statusLine": {"type": "command", "command": "cct statusline"}` in
`~/.claude/settings.json`. Without `oh-my-posh` it prints `breadcrumb | model`; with it, it runs
`oh-my-posh claude` with `CCT_CRUMB` set, so prefix the claude segment template with:

```
{{ if .Env.CCT_CRUMB }}{{ .Env.CCT_CRUMB }} | {{ end }}
```

## Usage

### CLI: `cct`

`cct` in a repo opens the picker:

| Key | Action |
| --- | --- |
| `⏎` | resume |
| `^f` / `^n` | fork / new conversation |
| `^r` | rename |
| `^e` | merge mode: `tab`/`space` select, `⏎` merges into the shallowest selection (ties: least recently updated); none selected merges into the parent |
| `^d` | drop (roots too; transcripts are kept) |
| `^a` / `^h` | show / hide closed |

Glyphs: `●` open, `✔` merged, `✗` dropped, `◐` merging, `◎` receiving.

### Claude Code plugin: `cct-threads`

The plugin adds `/threads`, `/merge [drop]` (summarize, confirm with `y`, resume the parent) and a
band reached with `ctrl-x tab`.

### CLI subcommands

`cct tree [--json] [dir] [all]`, `show`, `crumb`, `statusline`,
`merge <id> [drop] [--stay] [--into <id>]`, `summary <id> [drop]`, `rename <id> [name]`,
`inbox <id> [--ack]`, `next <id>`, `selftest`.

`cct` parses Claude Code's internal transcript format; run `cct selftest` after Claude updates.

## Contents

| Path | What |
| --- | --- |
| `bin/cct` | Bash script: fzf picker, tree, merge/drop, statusline breadcrumb |
| `cct-threads/` | Claude Code plugin: band, Threads pane, `/threads`, `/merge [drop]` |
| `.claude-plugin/marketplace.json` | Local marketplace exposing the plugin |

## Alternatives

Yes, I know about [agterm](https://agterm.com/) (macOS only), and
[ThinkTerm](https://github.com/RoversX/ThinkTerm), [PurpleMux](https://github.com/subicura/purplemux),
[Herdr](https://herdr.dev/) and probably many more.

They are multiplexers: they manage the terminals and sessions agents run in. cct leaves that to
your terminal and window manager, and manages the conversations themselves: where you are in
the tree, and closing branches by merging their context back.

## License

Copyright (C) 2026 widogg. Licensed under the GNU General Public License,
version 2 (GPL-2.0-only).
