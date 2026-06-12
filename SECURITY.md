# Security Policy

NetDigest processes network traffic of the inspected page **locally, inside the DevTools session**. It has no backend, no analytics, and never transmits capture data anywhere. Auth headers and cookies are never captured; sensitive values are redacted at capture time.

## Reporting a vulnerability

If you find a way to make NetDigest leak captured data, bypass redaction, execute code in the inspected page beyond its documented recorder, or escalate extension privileges:

- **Do not open a public issue.**
- Email **djdevpro@gmail.com** (subject: `[netdigest security]`) or use GitHub's private vulnerability reporting on this repository.
- Include reproduction steps and the extension version (`chrome://extensions`).

You can expect an acknowledgement within a few days. Please give us reasonable time to ship a fix before public disclosure.

## Supported versions

Only the latest released version is supported. The extension has no server side, so updating is the fix.
