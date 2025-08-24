#!/bin/bash

# Fix column references in JavaScript files
echo "Fixing column references in controllers..."

# Fix album_year -> year
find src -name "*.js" -type f -exec sed -i 's/album_year/year/g' {} \;

# Fix file_path -> path  
find src -name "*.js" -type f -exec sed -i 's/file_path/path/g' {} \;

# Fix last_modified -> created_at (since we don't have last_modified)
find src -name "*.js" -type f -exec sed -i 's/last_modified/created_at/g' {} \;

echo "Column references fixed!"