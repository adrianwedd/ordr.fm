# Fix for Missing Rate Limiting Security Alerts

## Issue Summary
CodeQL detected 8 high-severity missing rate limiting vulnerabilities in `visualization/server.js`. All API endpoints lack rate limiting, which could allow denial of service attacks.

## Solution

### Install express-rate-limit
```bash
cd visualization
npm install express-rate-limit
```

### Update visualization/server.js

Add this near the top after the requires:
```javascript
const rateLimit = require('express-rate-limit');

// Create rate limiter - 100 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all API routes
app.use('/api/', limiter);

// Stricter rate limit for export endpoint (10 per hour)
const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 exports per hour
    message: 'Export rate limit exceeded. Please try again later.',
});

// Apply stricter limit to export endpoint
app.use('/api/export', exportLimiter);
```

### Alternative: Update server/server.js

For the main server, add similar rate limiting:
```javascript
const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests, please try again later.',
});

// Stricter rate limit for MusicBrainz endpoints
const mbLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 1 request per second average
    message: 'MusicBrainz API rate limit. Please slow down.',
});

// Apply rate limiting
app.use('/api/', apiLimiter);
app.use('/api/musicbrainz/', mbLimiter);
```

## Benefits
- Prevents denial of service attacks
- Protects against API abuse
- Ensures fair resource usage
- Maintains service availability

## Testing
```bash
# Test rate limiting with curl
for i in {1..150}; do
    curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/stats
done
# Should see 429 (Too Many Requests) after 100 requests
```