# Security policy

Annotant runs on developers' machines, next to their source code, and hands
text taken from a web page to Claude Code agents that can edit files. We take
reports about it seriously.

## Supported versions

Only the latest release is supported: fixes ship as a new version. Update with
`claude plugin marketplace update annotant` before reporting.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/annotant/annotant/security/advisories/new).

Include what you can of:

- the affected component (see [Scope](#scope)) and commit;
- the steps or a proof of concept that reproduces it;
- the impact you expect: what an attacker can read, run or change, and from where.

What happens next:

1. We acknowledge the report within **7 days**.
2. We confirm or rule out the issue, and share our assessment and a fix plan,
   within **30 days**.
3. We fix it in a private fork, publish the fix and a
   [security advisory](https://github.com/annotant/annotant/security/advisories),
   and credit you unless you prefer otherwise.

We ask you to keep the issue private until the advisory is published, and at
most **90 days** after your report.

## Scope

In scope, in this repository:

- **The local server** (`skills/annotant/scripts/server.mjs`): it must only
  listen on `127.0.0.1` and only answer cross-origin requests from `localhost`
  origins or the project's `devOrigins`. Reaching it from another origin or
  another machine, or reading or writing files through it, is a vulnerability.
- **The loader and the widget**: the loader must be removed from production
  builds by the bundler's dev flag, and the widget must not run script taken
  from comments or page content (XSS in the host app).
- **The hooks and file locks** (`hooks/register.ts`): bypassing a lock, or
  making a hook run a command it should not.
- **Prompt injection**: text of the commented page or of a comment making an
  agent act outside the comment's intent or outside the project's `editable`
  folders.
- **This repository's supply chain**: its dependencies, the committed
  `widget/dist/widget.js`, and its GitHub Actions workflows.

Out of scope:

- Vulnerabilities in Claude Code itself: report them to Anthropic
  ([responsible disclosure](https://www.anthropic.com/responsible-disclosure-policy)).
- Vulnerabilities in the app a user reviews with Annotant.
- Attacks that need an attacker to already run code as the user on their machine.
