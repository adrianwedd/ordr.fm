#!/bin/bash
# Automated issue grooming for ordr.fm
# Run this script to update issue labels and generate reports

set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

REPO="adrianwedd/ordr.fm"

echo -e "${BLUE}🧹 ordr.fm Issue Grooming - $(date)${NC}"
echo "======================================="

# Update implemented features based on recent commits
echo -e "\n${YELLOW}Checking for implemented features...${NC}"

# Features implemented in recent sessions
IMPLEMENTED_FEATURES=(
    "34:Parallel processing"
    "19:Discogs API integration"
    "20:Electronic music organization"
    "26:Artist alias resolution"
    "38:Security hardening"
)

for feature in "${IMPLEMENTED_FEATURES[@]}"; do
    IFS=':' read -r issue_num description <<< "$feature"
    if gh issue view $issue_num --repo $REPO --json state -q '.state' | grep -q "OPEN"; then
        echo -e "  Marking #$issue_num ($description) as implemented"
        gh issue edit $issue_num --repo $REPO --add-label "implemented" 2>/dev/null || true
        gh issue close $issue_num --repo $REPO --comment "✅ Implemented in recent sessions" 2>/dev/null || true
    fi
done

# Auto-categorize new issues
echo -e "\n${YELLOW}Categorizing issues...${NC}"

# Performance-related
gh issue list --repo $REPO --state open --json number,title,body,labels | \
    jq -r '.[] | select(.labels | map(.name) | contains(["performance"]) | not) | select(.title + .body | test("parallel|performance|speed|optimization"; "i")) | .number' | \
    while read -r num; do
        echo -e "  Adding 'performance' label to #$num"
        gh issue edit $num --repo $REPO --add-label "performance" 2>/dev/null || true
    done

# Electronic music features
gh issue list --repo $REPO --state open --json number,title,body,labels | \
    jq -r '.[] | select(.labels | map(.name) | contains(["electronic-music"]) | not) | select(.title + .body | test("electronic|discogs|label|vinyl|remix"; "i")) | .number' | \
    while read -r num; do
        echo -e "  Adding 'electronic-music' label to #$num"
        gh issue edit $num --repo $REPO --add-label "electronic-music" 2>/dev/null || true
    done

# Generate progress report
echo -e "\n${BLUE}📊 Progress Report${NC}"
echo "==================="

# Overall statistics
total_issues=$(gh issue list --repo $REPO --state all --json state | jq length)
open_issues=$(gh issue list --repo $REPO --state open --json state | jq length)
closed_issues=$(gh issue list --repo $REPO --state closed --json state | jq length)
completion_rate=$(echo "scale=1; $closed_issues * 100 / $total_issues" | bc)

echo -e "Total Issues: $total_issues"
echo -e "Open: ${YELLOW}$open_issues${NC} | Closed: ${GREEN}$closed_issues${NC}"
echo -e "Completion Rate: ${GREEN}${completion_rate}%${NC}"

# Implementation status
echo -e "\n${BLUE}Implementation Status:${NC}"
implemented=$(gh issue list --repo $REPO --label "implemented" --state all | wc -l)
in_progress=$(gh issue list --repo $REPO --label "in-progress" --state open | wc -l)
planned=$(gh issue list --repo $REPO --label "planned" --state open | wc -l)
ideas=$((open_issues - in_progress - planned))

echo -e "  ✅ Implemented: ${GREEN}$implemented${NC}"
echo -e "  🚧 In Progress: ${YELLOW}$in_progress${NC}"
echo -e "  📋 Planned: ${BLUE}$planned${NC}"
echo -e "  💡 Ideas/Backlog: $ideas"

# Feature categories
echo -e "\n${BLUE}Feature Categories:${NC}"
for category in "performance" "electronic-music" "safety" "ui" "enhancement"; do
    count=$(gh issue list --repo $REPO --label "$category" --state open | wc -l)
    printf "  %-20s %s\n" "$category:" "$count open"
done

# Priority distribution
echo -e "\n${BLUE}Priority Distribution:${NC}"
critical=$(gh issue list --repo $REPO --label "critical" --state open | wc -l)
high=$(gh issue list --repo $REPO --label "high-priority" --state open | wc -l)
medium=$(gh issue list --repo $REPO --label "medium-priority" --state open | wc -l)

echo -e "  🔴 Critical: ${RED}$critical${NC}"
echo -e "  🟠 High: ${YELLOW}$high${NC}"
echo -e "  🟡 Medium: $medium"

# Next recommended actions
echo -e "\n${BLUE}📋 Next Recommended Issues:${NC}"
echo -e "${YELLOW}High-value, low-effort enhancements:${NC}"
gh issue list --repo $REPO --state open --label "enhancement" --json number,title,body | \
    jq '.[] | select(.body | length < 300) | "#\(.number) \(.title)"' -r | head -5

echo -e "\n${YELLOW}Critical issues requiring attention:${NC}"
gh issue list --repo $REPO --state open --label "critical" --json number,title | jq -r '.[] | "#\(.number) \(.title)"'

# Recent activity
echo -e "\n${BLUE}📅 Recent Activity (last 7 days):${NC}"
recent_closed=$(gh issue list --repo $REPO --state closed --json number,title,closedAt | \
    jq --arg cutoff "$(date -d '7 days ago' -I)" '.[] | select(.closedAt >= $cutoff)' | jq length)
recent_opened=$(gh issue list --repo $REPO --state all --json number,title,createdAt | \
    jq --arg cutoff "$(date -d '7 days ago' -I)" '.[] | select(.createdAt >= $cutoff)' | jq length)

echo -e "  Opened: $recent_opened"
echo -e "  Closed: ${GREEN}$recent_closed${NC}"

# Save report
REPORT_FILE="issue_report_$(date +%Y%m%d).md"
{
    echo "# ordr.fm Issue Report - $(date)"
    echo
    echo "## Summary"
    echo "- Total Issues: $total_issues ($open_issues open, $closed_issues closed)"
    echo "- Completion Rate: ${completion_rate}%"
    echo "- Critical Issues: $critical"
    echo
    echo "## Implementation Status"
    echo "- ✅ Implemented: $implemented"
    echo "- 🚧 In Progress: $in_progress"
    echo "- 📋 Planned: $planned"
    echo "- 💡 Ideas/Backlog: $ideas"
    echo
    echo "## Next Actions"
    gh issue list --repo $REPO --state open --label "critical,high-priority" --json number,title,labels | \
        jq -r '.[:5] | .[] | "- #\(.number) \(.title)"'
} > "$REPORT_FILE"

echo -e "\n${GREEN}✅ Grooming complete! Report saved to $REPORT_FILE${NC}"
echo
echo -e "${BLUE}Quick commands for next session:${NC}"
echo "  gh issue list --repo $REPO --label 'high-priority' --state open"
echo "  gh issue view ISSUE_NUMBER --repo $REPO"
echo "  ./groom_issues.sh  # Run grooming again"