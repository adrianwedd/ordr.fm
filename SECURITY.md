# Security Policy

## 🔒 ordr.fm Security Commitment

We take security seriously in ordr.fm. This document outlines our security practices and how to report vulnerabilities.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.1.x   | :white_check_mark: |
| 2.0.x   | :x:                |
| < 2.0   | :x:                |

## Automated Security Management

### 🤖 CodeQL Scanning
- **Continuous scanning** of all code changes
- **Automatic issue creation** for security alerts
- **Severity-based prioritization** (Critical > High > Medium > Low)
- **Grouped alerts** for systematic issues (e.g., multiple rate limiting)

### 🔧 Automated Fixes
- **Rate limiting**: Automatic PR creation with express-rate-limit
- **Workflow permissions**: Automatic addition of explicit permissions
- **Dependency updates**: Dependabot for security patches

### 📊 Security Dashboard
- **Real-time status**: Security metrics updated every 6 hours
- **Alert tracking**: All CodeQL alerts tracked as GitHub issues
- **Progress monitoring**: Track resolution of security issues

## Security Best Practices

### For Users
1. **Keep updated**: Always use the latest version
2. **Secure configuration**: 
   - Store API tokens in environment variables
   - Use secure file permissions on config files
   - Run with minimal privileges
3. **Docker security**:
   - Use official images only
   - Run containers as non-root user
   - Use read-only volumes where possible

### For Contributors
1. **Code security**:
   - Always validate and sanitize inputs
   - Use parameterized queries for databases
   - Implement rate limiting on all API endpoints
   - Follow principle of least privilege
2. **Dependencies**:
   - Keep dependencies updated
   - Review security advisories
   - Use `npm audit` regularly
3. **Secrets**:
   - Never commit secrets or tokens
   - Use GitHub secrets for CI/CD
   - Rotate credentials regularly

## Reporting a Vulnerability

### 🚨 Critical Vulnerabilities
For critical security issues that could impact users:

1. **DO NOT** create a public issue
2. Email: security@ordr.fm (coming soon)
3. Or use GitHub's private vulnerability reporting:
   - Go to Security tab → Report a vulnerability
   - Provide detailed description and reproduction steps
   - Include impact assessment

### Response Timeline
- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Fix Timeline**: Based on severity
  - Critical: 1-3 days
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

## Security Features

### Current Implementation
- ✅ **Rate Limiting**: Prevents DoS attacks
- ✅ **Input Validation**: Sanitizes filenames and metadata
- ✅ **SQL Injection Protection**: Parameterized queries
- ✅ **Container Security**: Non-root user, minimal attack surface
- ✅ **HTTPS Only**: Secure API communications
- ✅ **Token Security**: Environment-based credential storage

### Planned Enhancements
- 🔄 **API Authentication**: OAuth2 for API access
- 🔄 **Audit Logging**: Comprehensive security event logging
- 🔄 **Encryption at Rest**: For sensitive metadata
- 🔄 **RBAC**: Role-based access control for enterprise
- 🔄 **Security Headers**: Enhanced HTTP security headers

## Security Workflows

### Automated Security Pipeline
```yaml
1. Code Push/PR
   ↓
2. CodeQL Analysis
   ↓
3. Security Alerts Generated
   ↓
4. GitHub Issues Created
   ↓
5. Automated Fix PRs (where possible)
   ↓
6. Manual Review & Merge
   ↓
7. Security Status Updated
```

### Manual Security Review
- All PRs reviewed for security implications
- Security checklist for major features
- Regular dependency audits
- Penetration testing for major releases

## Third-Party Security

### API Integrations
- **Discogs API**: Rate-limited, token-based authentication
- **MusicBrainz API**: Rate-limited, follows usage guidelines
- **No data sharing**: User data never shared with third parties

### Dependencies
- Regular security updates via Dependabot
- Manual review of major dependency changes
- Security audit before each release

## Compliance

### Data Protection
- **Local-first**: All data processing happens locally
- **No telemetry**: No usage data collected
- **User control**: Users have full control over their data
- **GDPR compliant**: No personal data collection

### Open Source Security
- **Transparent**: All security fixes are public
- **Community-driven**: Security improvements from contributors
- **Auditable**: Full source code available for review

## Security Contact

- **GitHub Issues**: For non-critical security improvements
- **Security Tab**: For private vulnerability reports
- **Email**: security@ordr.fm (coming soon)
- **Response**: Within 48 hours for critical issues

---

*Last updated: 2025-01-05*
*Security policy version: 1.0*