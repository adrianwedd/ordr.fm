# ordr.fm Production Readiness Checklist

Use this checklist before deploying ordr.fm in production environments.

## Pre-Deployment

### System Requirements
- [ ] Linux/macOS system with Bash 4.0+
- [ ] Minimum 4GB RAM (8GB+ recommended)
- [ ] Sufficient storage for music + 10% overhead
- [ ] CPU: 4+ cores for parallel processing

### Dependencies
- [ ] `exiftool` v12.0+ installed
- [ ] `jq` v1.6+ installed
- [ ] `sqlite3` v3.31+ installed
- [ ] `parallel` installed (optional but recommended)
- [ ] All dependencies verified: `./test_runner.sh`

### Initial Setup
- [ ] Repository cloned to production location
- [ ] Scripts have execute permissions
- [ ] Configuration file created from template
- [ ] Test run completed successfully
- [ ] Backup strategy defined

## Configuration

### Basic Settings
- [ ] `SOURCE_DIR` points to correct location
- [ ] `DEST_DIR` has sufficient space
- [ ] `UNSORTED_BASE_DIR` configured
- [ ] `DRY_RUN=0` for production
- [ ] `LOG_FILE` path is writable

### Performance Settings
- [ ] `ENABLE_PARALLEL=1` for better performance
- [ ] `PARALLEL_JOBS` optimized for system
- [ ] `BATCH_SIZE` set appropriately
- [ ] Database paths on fast storage (SSD)

### Feature Settings
- [ ] Electronic music features configured if needed
- [ ] Discogs API token set (if using)
- [ ] Artist alias groups defined
- [ ] Organization mode selected

## Security

### File Permissions
- [ ] Config file permissions: 640
- [ ] Database permissions: 660
- [ ] Script permissions: 750
- [ ] Log directory permissions set

### Access Control
- [ ] Dedicated user account created
- [ ] Group permissions configured
- [ ] sudo access limited appropriately
- [ ] API tokens stored securely

### Network Security
- [ ] Firewall rules for API access
- [ ] Proxy configuration (if required)
- [ ] SSL/TLS for API calls verified

## Testing

### Functional Testing
- [ ] Dry run on sample data successful
- [ ] Metadata extraction working
- [ ] Organization logic verified
- [ ] Database operations tested
- [ ] Error handling confirmed

### Performance Testing
- [ ] Benchmarked with expected load
- [ ] Parallel processing tested
- [ ] Memory usage acceptable
- [ ] I/O performance verified
- [ ] Network latency acceptable (if using NAS)

### Integration Testing
- [ ] Full workflow tested end-to-end
- [ ] Incremental mode tested
- [ ] Rollback functionality verified
- [ ] Monitoring integration tested
- [ ] Backup/restore tested

## Deployment

### Installation
- [ ] Production directory created
- [ ] Files copied to production location
- [ ] Permissions set correctly
- [ ] Service account configured
- [ ] Environment variables set

### Automation
- [ ] Systemd service created (if applicable)
- [ ] Cron jobs configured (if applicable)
- [ ] Watch folder setup (if applicable)
- [ ] Log rotation configured
- [ ] Monitoring alerts configured

### Documentation
- [ ] Runbook created for operations team
- [ ] Recovery procedures documented
- [ ] Contact information updated
- [ ] Change log maintained
- [ ] Known issues documented

## Monitoring

### Logging
- [ ] Log level appropriate for production
- [ ] Log rotation configured
- [ ] Log aggregation setup (if applicable)
- [ ] Error alerting configured
- [ ] Audit logging enabled

### Metrics
- [ ] Key metrics identified
- [ ] Monitoring dashboard created
- [ ] Alert thresholds defined
- [ ] Performance baselines established
- [ ] Capacity planning metrics tracked

### Health Checks
- [ ] Health check script deployed
- [ ] Automated health monitoring
- [ ] Database integrity checks scheduled
- [ ] Disk space monitoring active
- [ ] Process monitoring configured

## Backup & Recovery

### Backup Strategy
- [ ] Database backup automated
- [ ] Configuration backup included
- [ ] Backup retention policy defined
- [ ] Backup verification process
- [ ] Offsite backup configured

### Recovery Planning
- [ ] Recovery procedures documented
- [ ] RTO/RPO defined and tested
- [ ] Rollback procedures tested
- [ ] Data integrity verification
- [ ] Communication plan established

## Operations

### Maintenance
- [ ] Maintenance windows defined
- [ ] Update procedures documented
- [ ] Database maintenance scheduled
- [ ] Log cleanup automated
- [ ] Performance tuning schedule

### Support
- [ ] Support contacts defined
- [ ] Escalation procedures documented
- [ ] Known issues documented
- [ ] FAQ created for common issues
- [ ] Troubleshooting guide available

## Go-Live

### Final Checks
- [ ] All checklist items completed
- [ ] Stakeholders notified
- [ ] Rollback plan ready
- [ ] Support team briefed
- [ ] Monitoring active

### Post-Deployment
- [ ] Initial run monitored closely
- [ ] Performance metrics collected
- [ ] Error logs reviewed
- [ ] User feedback collected
- [ ] Documentation updated

## Sign-offs

- [ ] System Administrator: _______________ Date: ___________
- [ ] Security Team: _______________ Date: ___________
- [ ] Operations Team: _______________ Date: ___________
- [ ] Project Owner: _______________ Date: ___________

## Notes

_Add any deployment-specific notes here:_

---

Remember: Always test in a staging environment that mirrors production before deploying!