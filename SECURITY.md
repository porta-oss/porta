# Security Policy

## Supported Versions

Porta is in **public alpha**. Security fixes are applied to the latest release only.

| Version | Supported |
|---------|-----------|
| Latest alpha | ✅ |
| Older releases | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

To report a security vulnerability, please use one of these private channels:

1. **GitHub Security Advisories** (preferred): Use the [private vulnerability reporting](../../security/advisories/new) feature on this repository.
2. **Email**: Send details to **security@porta.dev**.

### What to Include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof of concept
- The affected component (API, web app, worker, shared package)
- Any suggested fix, if you have one

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Assessment** within 7 days, including severity classification
- **Resolution timeline** communicated after assessment — typically within 30 days for critical issues
- **Credit** in the release notes (unless you prefer to remain anonymous)

We will not take legal action against researchers who report vulnerabilities responsibly and in good faith.

## Security Considerations for Self-Hosters

If you are self-hosting Porta, review these areas:

- **Connector credentials** are encrypted at rest with AES-256-GCM. Keep `CONNECTOR_ENCRYPTION_KEY` secret and unique per deployment.
- **`BETTER_AUTH_SECRET`** must be at least 32 characters and kept secret.
- **Database access** should be restricted to the API and worker services only.
- **Redis** should not be exposed to the public internet.
- **HTTPS** should be enforced in production for both the API and web app.

See [docs/self-hosting.md](docs/self-hosting.md) for full deployment guidance.

## Community Support

For general security questions (not vulnerability reports), use [GitHub Discussions](../../discussions) or [Discord](https://discord.gg/porta). Porta is community-supported — there is no paid security support tier.
