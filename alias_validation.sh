#!/bin/bash
# Artist Alias Configuration Validation for ordr.fm
# Provides comprehensive validation and error checking for alias groups

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validation error tracking
declare -a VALIDATION_ERRORS
declare -a VALIDATION_WARNINGS

# Add error message
add_error() {
    VALIDATION_ERRORS+=("$1")
}

# Add warning message
add_warning() {
    VALIDATION_WARNINGS+=("$1")
}

# Validate artist alias configuration
validate_artist_aliases() {
    local alias_groups="${1:-$ARTIST_ALIAS_GROUPS}"
    local verbose="${2:-$VERBOSE}"
    
    # Reset error tracking
    VALIDATION_ERRORS=()
    VALIDATION_WARNINGS=()
    
    echo -e "${BLUE}=== Validating Artist Alias Configuration ===${NC}"
    echo
    
    # Check if alias groups are configured
    if [[ -z "$alias_groups" ]]; then
        echo -e "${YELLOW}Info: No artist alias groups configured${NC}"
        return 0
    fi
    
    # Track statistics
    local total_groups=0
    local total_aliases=0
    local max_group_size=0
    local min_group_size=999
    
    # Track duplicates
    declare -A seen_artists
    declare -A duplicate_artists
    declare -A group_primaries
    
    # Parse and validate each group
    IFS='|' read -ra groups <<< "$alias_groups"
    
    for group_index in "${!groups[@]}"; do
        local group="${groups[$group_index]}"
        ((total_groups++))
        
        # Check for empty group
        if [[ -z "$group" ]]; then
            add_error "Group $((group_index + 1)): Empty group found"
            continue
        fi
        
        # Parse aliases in group
        IFS=',' read -ra aliases <<< "$group"
        local group_size=${#aliases[@]}
        
        # Check group size
        if [[ $group_size -eq 0 ]]; then
            add_error "Group $((group_index + 1)): No aliases in group"
            continue
        fi
        
        if [[ $group_size -eq 1 ]]; then
            add_warning "Group $((group_index + 1)): Only one artist '${aliases[0]}' (no aliases)"
        fi
        
        # Update statistics
        ((total_aliases += group_size))
        [[ $group_size -gt $max_group_size ]] && max_group_size=$group_size
        [[ $group_size -lt $min_group_size ]] && min_group_size=$group_size
        
        # Get primary artist (first in group)
        local primary="${aliases[0]}"
        
        # Validate primary artist
        if [[ -z "$primary" ]]; then
            add_error "Group $((group_index + 1)): Empty primary artist"
            continue
        fi
        
        # Check for whitespace issues
        local trimmed_primary=$(echo "$primary" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        if [[ "$primary" != "$trimmed_primary" ]]; then
            add_warning "Group $((group_index + 1)): Primary artist '$primary' has leading/trailing whitespace"
        fi
        
        # Store primary for cross-group validation
        group_primaries["$primary"]=1
        
        # Check each alias in the group
        for alias_index in "${!aliases[@]}"; do
            local alias="${aliases[$alias_index]}"
            
            # Check for empty alias
            if [[ -z "$alias" ]]; then
                add_error "Group $((group_index + 1)), Alias $((alias_index + 1)): Empty alias"
                continue
            fi
            
            # Check for whitespace issues
            local trimmed_alias=$(echo "$alias" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            if [[ "$alias" != "$trimmed_alias" ]]; then
                add_warning "Group $((group_index + 1)): Alias '$alias' has leading/trailing whitespace"
            fi
            
            # Normalize for duplicate checking
            local normalized=$(echo "$trimmed_alias" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g')
            
            # Check for duplicates across groups
            if [[ -n "${seen_artists[$normalized]}" ]]; then
                local prev_group="${seen_artists[$normalized]}"
                if [[ "$prev_group" != "$((group_index + 1))" ]]; then
                    add_error "Duplicate: '$alias' appears in both group $prev_group and group $((group_index + 1))"
                    duplicate_artists["$alias"]=1
                fi
            else
                seen_artists["$normalized"]="$((group_index + 1))"
            fi
            
            # Check for special characters that might cause issues
            if [[ "$alias" =~ [\'\"\`\$\(\)\{\}\[\]\<\>\&\;\|] ]]; then
                add_warning "Group $((group_index + 1)): Alias '$alias' contains special characters that may cause issues"
            fi
            
            # Check for very long names
            if [[ ${#alias} -gt 100 ]]; then
                add_warning "Group $((group_index + 1)): Alias '$alias' is very long (${#alias} chars)"
            fi
        done
        
        # Verbose output for this group
        if [[ "$verbose" == "1" ]]; then
            echo -e "Group $((group_index + 1)): Primary='$primary', Aliases=${group_size}"
            for alias in "${aliases[@]:1}"; do
                echo "  - $alias"
            done
        fi
    done
    
    # Additional validation checks
    
    # Check if any primary artist is also an alias in another group
    for primary in "${!group_primaries[@]}"; do
        local normalized=$(echo "$primary" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g')
        if [[ -n "${seen_artists[$normalized]}" ]]; then
            local group_num="${seen_artists[$normalized]}"
            # Check if this primary appears as non-primary in another group
            for group_index in "${!groups[@]}"; do
                local group="${groups[$group_index]}"
                IFS=',' read -ra aliases <<< "$group"
                for i in "${!aliases[@]}"; do
                    if [[ $i -gt 0 ]]; then  # Skip primary (index 0)
                        local alias="${aliases[$i]}"
                        local alias_norm=$(echo "$alias" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g')
                        if [[ "$normalized" == "$alias_norm" ]]; then
                            add_error "Conflict: '$primary' is primary in one group but alias in group $((group_index + 1))"
                        fi
                    fi
                done
            done
        fi
    done
    
    # Display results
    echo
    echo -e "${BLUE}=== Validation Summary ===${NC}"
    echo "Groups: $total_groups"
    echo "Total aliases: $total_aliases"
    echo "Average aliases per group: $((total_aliases / total_groups))"
    echo "Largest group: $max_group_size aliases"
    echo "Smallest group: $min_group_size aliases"
    echo
    
    # Display errors
    if [[ ${#VALIDATION_ERRORS[@]} -gt 0 ]]; then
        echo -e "${RED}Errors found (${#VALIDATION_ERRORS[@]}):${NC}"
        for error in "${VALIDATION_ERRORS[@]}"; do
            echo -e "  ${RED}✗${NC} $error"
        done
        echo
    fi
    
    # Display warnings
    if [[ ${#VALIDATION_WARNINGS[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Warnings (${#VALIDATION_WARNINGS[@]}):${NC}"
        for warning in "${VALIDATION_WARNINGS[@]}"; do
            echo -e "  ${YELLOW}⚠${NC} $warning"
        done
        echo
    fi
    
    # Overall result
    if [[ ${#VALIDATION_ERRORS[@]} -eq 0 ]]; then
        if [[ ${#VALIDATION_WARNINGS[@]} -eq 0 ]]; then
            echo -e "${GREEN}✓ Alias configuration is valid${NC}"
            return 0
        else
            echo -e "${YELLOW}⚠ Alias configuration has warnings but is usable${NC}"
            return 0
        fi
    else
        echo -e "${RED}✗ Alias configuration has errors that must be fixed${NC}"
        return 1
    fi
}

# Suggest fixes for common issues
suggest_alias_fixes() {
    local alias_groups="${1:-$ARTIST_ALIAS_GROUPS}"
    
    echo -e "${BLUE}=== Suggested Fixes ===${NC}"
    echo
    
    local fixed_groups=""
    IFS='|' read -ra groups <<< "$alias_groups"
    
    for group in "${groups[@]}"; do
        if [[ -z "$group" ]]; then
            continue  # Skip empty groups
        fi
        
        # Fix whitespace in aliases
        IFS=',' read -ra aliases <<< "$group"
        local fixed_aliases=()
        
        for alias in "${aliases[@]}"; do
            # Trim whitespace
            local fixed=$(echo "$alias" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            if [[ -n "$fixed" ]]; then
                fixed_aliases+=("$fixed")
            fi
        done
        
        # Rebuild group
        if [[ ${#fixed_aliases[@]} -gt 0 ]]; then
            local fixed_group=$(IFS=','; echo "${fixed_aliases[*]}")
            if [[ -n "$fixed_groups" ]]; then
                fixed_groups="${fixed_groups}|${fixed_group}"
            else
                fixed_groups="$fixed_group"
            fi
        fi
    done
    
    echo "Cleaned configuration:"
    echo "$fixed_groups"
    echo
    echo "To apply, update ARTIST_ALIAS_GROUPS in ordr.fm.conf"
}

# Test alias resolution with sample names
test_alias_resolution() {
    local test_names=("$@")
    
    if [[ ${#test_names[@]} -eq 0 ]]; then
        # Default test cases
        test_names=("Atom Heart" "Uwe Schmidt" "aphex twin" "AFX" "Unknown Artist")
    fi
    
    echo -e "${BLUE}=== Testing Alias Resolution ===${NC}"
    echo
    
    # Source the optimization if available
    if [[ -f "./alias_optimization.sh" ]]; then
        source "./alias_optimization.sh"
        parse_alias_groups_once
    fi
    
    for name in "${test_names[@]}"; do
        local resolved=$(resolve_artist_alias "$name" 2>/dev/null || echo "$name")
        local aliases=$(get_artist_aliases "$name" 2>/dev/null || echo "$name")
        
        echo "Input: '$name'"
        echo "  Resolved to: '$resolved'"
        echo "  All aliases: $aliases"
        echo
    done
}

# Export validation functions
export -f validate_artist_aliases
export -f suggest_alias_fixes
export -f test_alias_resolution

# Main function for standalone usage
main() {
    case "${1:-validate}" in
        validate)
            validate_artist_aliases "$ARTIST_ALIAS_GROUPS" "${2:-0}"
            ;;
        fix)
            validate_artist_aliases "$ARTIST_ALIAS_GROUPS" "0"
            echo
            suggest_alias_fixes "$ARTIST_ALIAS_GROUPS"
            ;;
        test)
            shift
            test_alias_resolution "$@"
            ;;
        *)
            echo "Usage: $0 {validate|fix|test} [options]"
            echo ""
            echo "Commands:"
            echo "  validate [verbose]  - Validate current alias configuration"
            echo "  fix                - Suggest fixes for configuration issues"
            echo "  test [names...]    - Test alias resolution with sample names"
            exit 1
            ;;
    esac
}

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Load configuration if available
    if [[ -f "./ordr.fm.conf" ]]; then
        source "./ordr.fm.conf"
    fi
    
    main "$@"
fi