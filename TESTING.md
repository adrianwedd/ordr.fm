# Testing Strategy

## Ultra-Lean CI, Comprehensive Local Testing

This project uses a cost-optimized testing strategy designed to minimize CI costs while maintaining thorough quality assurance.

### CI Testing (Ultra Lean)
- **4 smoke tests** in 1 browser (Chromium)
- **Purpose**: Basic functionality validation, server health checks
- **Runtime**: ~30 seconds
- **Cost**: Minimal

```bash
# CI runs this automatically
npm run test:e2e:ci
```

### Local Testing (Comprehensive) 
- **1297 tests** across 7 browsers
- **Coverage**: Full cross-browser compatibility, PWA features, mobile responsiveness
- **Purpose**: Thorough quality assurance before pushing
- **Runtime**: ~15-20 minutes

```bash
# Run comprehensive local tests
npm run test:e2e:local

# Interactive testing
npm run test:e2e:ui

# Debug mode
npm run test:e2e:headed
```

### Browser Matrix
**CI**: Chromium only (smoke tests)
**Local**: 
- Desktop: Chromium, Firefox, WebKit
- Mobile: Chrome, Safari  
- PWA: Desktop, Mobile

### Test Files
- `00-ci-smoke.spec.js` - Minimal CI smoke tests
- `01-*.spec.js` - Comprehensive feature tests (local only)

### Cost Impact
- **Before**: 2104 CI test runs
- **After**: 4 CI test runs (99.7% reduction)
- **Quality**: Maintained through comprehensive local testing

## Development Workflow

1. **Before committing**: Run `npm run test:e2e:local` 
2. **CI validation**: Automatic smoke tests on push
3. **Pre-release**: Full local test suite across all browsers

This approach ensures quality while keeping CI costs minimal.