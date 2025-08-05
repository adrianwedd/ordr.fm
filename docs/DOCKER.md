# 🐳 Docker Deployment Guide

**Complete Docker setup for ordr.fm music organization system**

## Quick Start

### 1. Prerequisites
- Docker 20.10+ and Docker Compose
- At least 2GB RAM available for container
- Music directories accessible to Docker

### 2. Setup Configuration
```bash
# Clone the repository
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm

# Copy environment template
cp .env.example .env

# Edit .env with your paths and API tokens
nano .env
```

### 3. Launch ordr.fm
```bash
# Start web interface only
docker-compose up -d

# Access dashboard
open http://localhost:3000
```

## Configuration

### Environment Variables (.env file)
```bash
# Music Directories (host paths)
MUSIC_SOURCE_DIR=/path/to/unsorted/music
MUSIC_DEST_DIR=/path/to/organized/music
MUSIC_UNSORTED_DIR=/path/to/review/music

# API Tokens
DISCOGS_USER_TOKEN=your_discogs_token
MUSICBRAINZ_USER_AGENT=YourApp/1.0

# Processing Options
ORDR_ENABLE_PARALLEL=1
ORDR_MAX_PARALLEL_JOBS=4
ORDR_ENABLE_ELECTRONIC=1
```

## Usage Modes

### Web Interface Mode (Default)
```bash
# Start web server for visualization and API access
docker-compose up -d
```

### Organization Mode
```bash
# Run music organization with web interface
docker-compose run --rm ordr-fm both --enable-electronic --discogs --move

# Organization only (no web interface)
docker-compose --profile organize run --rm ordr-fm-organizer
```

### Interactive Mode
```bash
# Open bash shell in container
docker-compose run --rm ordr-fm bash

# Run commands manually
./ordr.fm.sh --help
./ordr.fm.sh --source /app/data/music --move
```

## Volume Mapping

### Required Volumes
- **Music Source**: Your unsorted music collection (read-only)
- **Music Destination**: Where organized music will be stored
- **Configuration**: Persistent configuration files
- **Databases**: SQLite databases for metadata and state

### Example Volume Setup
```yaml
volumes:
  - "/media/music/unsorted:/app/data/music:ro"      # Read-only source
  - "/media/music/organized:/app/data/organized"    # Organized output
  - "/media/music/review:/app/data/unsorted"        # Manual review
  - "./config:/app/config"                          # Configuration
  - "./databases:/app"                               # Database persistence
```

## Advanced Configuration

### Custom Configuration File
```bash
# Mount custom configuration
docker-compose run --rm \
  -v ./my-config.conf:/app/config/ordr.fm.conf:ro \
  ordr-fm organize --move
```

### API Token Security
```bash
# Use Docker secrets (Docker Swarm)
echo "your_discogs_token" | docker secret create discogs_token -

# Or use external secrets management
docker-compose run --rm \
  -e DISCOGS_USER_TOKEN="$(cat /path/to/secret)" \
  ordr-fm organize --discogs --move
```

### Performance Tuning
```yaml
# docker-compose.override.yml
services:
  ordr-fm:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '4'
    environment:
      - ORDR_MAX_PARALLEL_JOBS=8
```

## Production Deployment

### Docker Swarm
```bash
# Deploy as stack
docker stack deploy -c docker-compose.yml ordr-fm

# Scale web interface
docker service scale ordr-fm_ordr-fm=2
```

### Kubernetes
```yaml
# k8s-deployment.yaml (example)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ordr-fm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ordr-fm
  template:
    metadata:
      labels:
        app: ordr-fm
    spec:
      containers:
      - name: ordr-fm
        image: ordr-fm:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: music-source
          mountPath: /app/data/music
          readOnly: true
        - name: music-organized
          mountPath: /app/data/organized
```

### Reverse Proxy (Nginx)
```nginx
# nginx.conf
server {
    listen 80;
    server_name music.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # WebSocket support for real-time updates
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Monitoring and Maintenance

### Health Checks
```bash
# Check container health
docker-compose ps

# View logs
docker-compose logs -f ordr-fm

# Check application health
curl http://localhost:3000/health
```

### Database Backup
```bash
# Backup databases
docker-compose exec ordr-fm cp /app/ordr.fm.metadata.db /app/config/backup-$(date +%Y%m%d).db

# Restore from backup
docker-compose run --rm \
  -v ./backup.db:/tmp/backup.db \
  ordr-fm cp /tmp/backup.db /app/ordr.fm.metadata.db
```

### Log Management
```bash
# Rotate logs
docker-compose exec ordr-fm logrotate /app/config/logrotate.conf

# View real-time processing
docker-compose exec ordr-fm tail -f /app/logs/ordr.fm.log
```

## Troubleshooting

### Common Issues

**Permission Denied**
```bash
# Fix ownership of mounted volumes
sudo chown -R 1001:1001 ./config ./databases ./logs

# Or run with host user
docker-compose run --user $(id -u):$(id -g) ordr-fm organize
```

**Out of Memory**
```bash
# Increase container memory limit
docker-compose run --rm -m 4g ordr-fm organize --max-parallel-jobs 2
```

**Network Issues**
```bash
# Test external API connectivity
docker-compose exec ordr-fm curl -I https://api.discogs.com
docker-compose exec ordr-fm curl -I https://musicbrainz.org
```

**Database Locked**
```bash
# Stop all containers accessing database
docker-compose down

# Start with fresh database connection
docker-compose up -d
```

### Debug Mode
```bash
# Run with debug logging
docker-compose run --rm \
  -e LOG_LEVEL=debug \
  ordr-fm organize --verbose
```

## Security Best Practices

### Container Security
- Runs as non-root user (UID 1001)
- Read-only source music volumes
- Minimal Alpine Linux base image
- No privileged escalation

### API Token Security
- Store tokens in `.env` file (not in images)
- Use Docker secrets in production
- Regular token rotation
- Monitor API usage

### Network Security
```bash
# Restrict network access
docker-compose run --rm --network none ordr-fm organize

# Use custom network
docker network create --driver bridge ordr-fm-net
```

## Building Custom Images

### Custom Dockerfile
```dockerfile
FROM ordr-fm:latest

# Add custom tools
RUN apk add --no-cache your-custom-tool

# Custom configuration
COPY my-custom.conf /app/config/ordr.fm.conf

# Custom entrypoint
COPY my-entrypoint.sh /app/custom-entrypoint.sh
RUN chmod +x /app/custom-entrypoint.sh

ENTRYPOINT ["/app/custom-entrypoint.sh"]
```

### Multi-architecture Builds
```bash
# Build for multiple platforms
docker buildx build --platform linux/amd64,linux/arm64 -t ordr-fm:multi .

# For Raspberry Pi
docker buildx build --platform linux/arm/v7 -t ordr-fm:pi .
```

## Integration Examples

### Home Assistant
```yaml
# configuration.yaml
shell_command:
  organize_music: >
    docker-compose -f /path/to/ordr.fm/docker-compose.yml 
    run --rm ordr-fm organize --move
```

### Cron Automation
```bash
# crontab entry for weekly organization
0 2 * * 0 cd /path/to/ordr.fm && docker-compose run --rm ordr-fm organize --enable-electronic --discogs --move
```

### File Monitoring
```bash
# Use inotify to trigger organization
inotifywait -m /music/incoming -e create | while read; do
  docker-compose run --rm ordr-fm organize --source /app/data/music --move
done
```

This Docker setup provides a complete, production-ready deployment of ordr.fm with minimal configuration required from users.