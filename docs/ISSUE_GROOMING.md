# ordr.fm Issue Grooming Commands

## 📊 Quick Issue Analytics

### Overview Commands
```bash
# Total issue count by state
gh issue list --repo adrianwedd/ordr.fm --json state --jq 'group_by(.state) | map({state: .[0].state, count: length})'

# Open issues by category
gh issue list --repo adrianwedd/ordr.fm --state open --json labels | jq -r '.[] | .labels[].name' | grep -E "^(feature|bug|enhancement|performance)" | sort | uniq -c

# Priority distribution
gh issue list --repo adrianwedd/ordr.fm --state open --json labels | jq -r '.[] | .labels[] | select(.name | contains("priority")) | .name' | sort | uniq -c

# Implementation status
gh issue list --repo adrianwedd/ordr.fm --state open --json labels | jq -r '.[] | .labels[] | select(.name | contains("implemented") or contains("planned") or contains("in-progress")) | .name' | sort | uniq -c
```

### Progress Tracking
```bash
# Completed features
gh issue list --repo adrianwedd/ordr.fm --state closed --label "implemented" --json number,title,closedAt | jq -r '.[] | "\(.closedAt | split("T")[0]) #\(.number) \(.title)"' | sort -r | head -10

# Next priorities
gh issue list --repo adrianwedd/ordr.fm --state open --label "high-priority" --json number,title,labels | jq -r '.[] | "#\(.number) \(.title)"'

# Blocked issues
gh issue list --repo adrianwedd/ordr.fm --state open --label "blocked" --json number,title,body | jq -r '.[] | "#\(.number) \(.title)\nBlocked by: \(.body | match("Blocked by: (.*)") | .captures[0].string // "Unknown")\n"'
```

## 🎯 Feature Category Management

### Core Features
```bash
# Metadata & organization features
gh issue list --repo adrianwedd/ordr.fm --query "metadata OR organization OR enrichment" --state open

# Performance features
gh issue list --repo adrianwedd/ordr.fm --query "performance OR parallel OR optimization" --state open

# Electronic music features
gh issue list --repo adrianwedd/ordr.fm --query "electronic OR discogs OR label" --state open

# Safety & recovery features
gh issue list --repo adrianwedd/ordr.fm --query "undo OR rollback OR safety OR backup" --state open
```

### Implementation Status
```bash
# Show implementation progress
echo "📈 ordr.fm Implementation Progress"
echo "================================="
echo "✅ Implemented: $(gh issue list --repo adrianwedd/ordr.fm --label "implemented" --state all | wc -l)"
echo "🚧 In Progress: $(gh issue list --repo adrianwedd/ordr.fm --label "in-progress" --state open | wc -l)"
echo "📋 Planned: $(gh issue list --repo adrianwedd/ordr.fm --label "planned" --state open | wc -l)"
echo "💡 Ideas: $(gh issue list --repo adrianwedd/ordr.fm --state open --json labels | jq '.[] | select(.labels | map(.name) | any(contains("implemented") or contains("planned") or contains("in-progress")) | not)' | wc -l)"
```

## 🏷️ Smart Labeling

### Auto-categorize issues
```bash
# Add feature labels based on content
gh issue list --repo adrianwedd/ordr.fm --state open --json number,title,body | jq -r '.[] | select(.title + .body | test("parallel|performance|speed"; "i")) | .number' | xargs -I {} gh issue edit {} --repo adrianwedd/ordr.fm --add-label "performance"

gh issue list --repo adrianwedd/ordr.fm --state open --json number,title,body | jq -r '.[] | select(.title + .body | test("electronic|discogs|label"; "i")) | .number' | xargs -I {} gh issue edit {} --repo adrianwedd/ordr.fm --add-label "electronic-music"

# Priority assignment
gh issue list --repo adrianwedd/ordr.fm --query "critical OR security OR data loss" --state open --json number --jq '.[].number' | xargs -I {} gh issue edit {} --repo adrianwedd/ordr.fm --add-label "high-priority"
```

### Status updates
```bash
# Mark completed features
gh issue edit ISSUE_NUMBER --repo adrianwedd/ordr.fm --remove-label "planned,in-progress" --add-label "implemented"

# Start working on issue
gh issue edit ISSUE_NUMBER --repo adrianwedd/ordr.fm --remove-label "planned" --add-label "in-progress"

# Close with implementation note
gh issue close ISSUE_NUMBER --repo adrianwedd/ordr.fm --comment "✅ Implemented in commit COMMIT_SHA"
```

## 📋 Session Planning

### Next session preparation
```bash
# Find high-value, low-effort features
gh issue list --repo adrianwedd/ordr.fm --state open --label "enhancement" --json number,title,body | jq '.[] | {number, title, effort: (if .body | length < 200 then "low" else "high" end)}' | jq 'select(.effort == "low")'

# Group by technical area
echo "🔧 Technical Areas:"
gh issue list --repo adrianwedd/ordr.fm --state open --json number,title | jq -r '.[] | 
  if .title | test("database|sql|db") then "Database: #\(.number) \(.title)"
  elif .title | test("api|discogs|metadata") then "APIs: #\(.number) \(.title)"
  elif .title | test("ui|web|dashboard") then "UI: #\(.number) \(.title)"
  elif .title | test("performance|parallel|speed") then "Performance: #\(.number) \(.title)"
  else "Other: #\(.number) \(.title)"
  end' | sort

# Dependencies check
gh issue view ISSUE_NUMBER --repo adrianwedd/ordr.fm --json body | jq -r '.body' | grep -E "#[0-9]+" -o | sort -u
```

## 🚀 Bulk Operations

### Session wrap-up
```bash
# Bulk close implemented features
IMPLEMENTED_ISSUES="34 19 20 26 37 38"
for issue in $IMPLEMENTED_ISSUES; do
  gh issue close $issue --repo adrianwedd/ordr.fm --comment "✅ Implemented in Session 5"
done

# Add session labels
gh issue list --repo adrianwedd/ordr.fm --state closed --json number,closedAt | jq --arg today "$(date -I)" '.[] | select(.closedAt | startswith($today)) | .number' | xargs -I {} gh issue edit {} --repo adrianwedd/ordr.fm --add-label "session-5"
```

### Milestone management
```bash
# Create milestone
gh api repos/adrianwedd/ordr.fm/milestones -f title="v2.0 - Production Ready" -f description="Core features for production use" -f due_on="2025-09-01T00:00:00Z"

# Assign issues to milestone
gh issue list --repo adrianwedd/ordr.fm --label "high-priority" --state open --json number --jq '.[].number' | xargs -I {} gh issue edit {} --repo adrianwedd/ordr.fm --milestone "v2.0 - Production Ready"
```

## 📈 Progress Reports

### Daily standup
```bash
#!/bin/bash
echo "📊 ordr.fm Daily Progress Report - $(date)"
echo "======================================="
echo
echo "🎯 Recently Completed:"
gh issue list --repo adrianwedd/ordr.fm --state closed --json number,title,closedAt | jq --arg cutoff "$(date -d '1 day ago' -I)" '.[] | select(.closedAt >= $cutoff) | "  #\(.number) \(.title)"' -r
echo
echo "🚧 In Progress:"
gh issue list --repo adrianwedd/ordr.fm --label "in-progress" --state open --json number,title -q '.[] | "  #\(.number) \(.title)"' -r
echo
echo "📋 Next Up:"
gh issue list --repo adrianwedd/ordr.fm --label "planned" --state open --json number,title -q '.[:3] | .[] | "  #\(.number) \(.title)"' -r
```

### Weekly summary
```bash
#!/bin/bash
echo "📊 ordr.fm Weekly Summary - Week of $(date -d 'last monday' +%Y-%m-%d)"
echo "========================================================"
echo
echo "✅ Completed This Week:"
gh issue list --repo adrianwedd/ordr.fm --state closed --json number,title,closedAt | jq --arg start "$(date -d 'last monday' -I)" '.[] | select(.closedAt >= $start) | "  #\(.number) \(.title)"' -r | wc -l
echo
echo "📈 Feature Categories Progress:"
for category in "performance" "electronic-music" "safety" "ui"; do
  total=$(gh issue list --repo adrianwedd/ordr.fm --label "$category" --state all | wc -l)
  closed=$(gh issue list --repo adrianwedd/ordr.fm --label "$category" --state closed | wc -l)
  percent=$((closed * 100 / (total + 1)))
  echo "  $category: $closed/$total ($percent%)"
done
```

## 🎯 Quick Reference

### Most useful commands
```bash
# What's next?
gh issue list --repo adrianwedd/ordr.fm --state open --label "planned" | head -5

# What's blocked?
gh issue list --repo adrianwedd/ordr.fm --state open --label "blocked"

# Recent activity
gh issue list --repo adrianwedd/ordr.fm --state all --json number,title,state,updatedAt | jq --arg cutoff "$(date -d '3 days ago' -I)" '.[] | select(.updatedAt >= $cutoff) | "\(.state): #\(.number) \(.title)"' -r | sort -r

# Implementation status
gh issue list --repo adrianwedd/ordr.fm --state open --json number,title,labels | jq '.[] | {number, title, status: (if any(.labels[]; .name == "implemented") then "✅" elif any(.labels[]; .name == "in-progress") then "🚧" elif any(.labels[]; .name == "planned") then "📋" else "💡" end)}' | jq -r '"\(.status) #\(.number) \(.title)"'
```

### Session planning
```bash
# High-impact features
gh issue list --repo adrianwedd/ordr.fm --state open --label "high-priority" --json number,title,labels | jq -r '.[] | "#\(.number) \(.title) [\(.labels | map(.name) | join(", "))]"'

# Quick wins
gh issue list --repo adrianwedd/ordr.fm --state open --label "good first issue,enhancement" --json number,title | jq -r '.[:5] | .[] | "#\(.number) \(.title)"'

# Technical debt
gh issue list --repo adrianwedd/ordr.fm --query "refactor OR cleanup OR technical debt" --state open
```

These commands help efficiently manage and track the ordr.fm project's GitHub issues! 🚀