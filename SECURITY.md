# Security policy

Moby is used in emergencies, so we take security reports seriously.

## Reporting a vulnerability

Please **don't open a public issue.** Report it privately through
[GitHub Security Advisories](https://github.com/Xlient/Moby/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge reports
within 72 hours, to tell you within 7 days whether we can reproduce it, and to keep you updated until it's
fixed. Please give us reasonable time to fix the problem before you disclose it. We're happy to credit you
in the release notes.

## Supported versions

Only the latest release and the live service are supported. Fixes ship in a new release, not as patches
to older ones.

## Scope

- This repository: the Moby app and, where present, its backend.
- The Moby service the official app talks to. Please test only against your own installation, or with
  permission. Never access other people's data, disrupt the service, or send false warnings or SOS messages.

Especially interesting: anything that could make an unverified report look official, hide a critical alert,
expose a person's location, or let someone send alerts or mesh messages they shouldn't.

Out of scope: reports from automated scanners with no demonstrated impact, denial of service, and social
engineering.

Thank you for helping keep Moby's users safe.
