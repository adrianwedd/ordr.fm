# File Browser → Processing Workflow Test Plan

## Test Objective
Verify the complete workflow from file browser folder selection through to actual music processing using ordr.fm.sh.

## Test Steps

### 1. PWA File Browser Testing
- [ ] Open http://localhost:3001
- [ ] Navigate to Actions tab
- [ ] Select "Browse Folders..." from source directory dropdown
- [ ] Verify modal opens with directory contents
- [ ] Navigate through directories to find music folders
- [ ] Select folder with audio files (should show 🎵 indicator)
- [ ] Click "Select This Folder" 
- [ ] Verify custom source input is populated with selected path

### 2. Processing Configuration
- [ ] Verify selected path is ready for processing
- [ ] Enable Discogs lookup if API token available
- [ ] Choose Electronic Mode if applicable
- [ ] Select between "Dry Run" and "Process & Move"

### 3. Integration with ordr.fm.sh
- [ ] Verify selected path works with main script
- [ ] Test dry run mode: `./ordr.fm.sh --source "/selected/path" --verbose`
- [ ] Check processing output and logs
- [ ] Verify database updates in visualization

### 4. App Control Testing
- [ ] Test "Reload App" button
- [ ] Test "Clear Cache" functionality  
- [ ] Test "Check Updates" feature
- [ ] Verify PWA status indicators

### 5. Production Deployment Verification
- [ ] Confirm PM2 process management working
- [ ] Check logs: `./deploy.sh logs`
- [ ] Verify health endpoint: `curl http://localhost:3001/api/health`
- [ ] Test PWA offline functionality
- [ ] Verify service worker caching

## Expected Results
- File browser seamlessly integrates with processing workflow
- Selected paths work correctly with ordr.fm.sh
- PWA maintains state across interactions
- Production deployment is stable and performant
- All new features work in production environment