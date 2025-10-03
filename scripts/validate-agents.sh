#!/usr/bin/env bash
# Validates YAML frontmatter in agent definition files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENTS_DIR="$REPO_ROOT/agents"

errors=0

echo "Validating agent YAML frontmatter..."

for agent_file in "$AGENTS_DIR"/*.md; do
    if [ ! -f "$agent_file" ]; then
        continue
    fi

    filename=$(basename "$agent_file")
    echo -n "  Checking $filename... "

    # Extract YAML frontmatter (between first two --- markers)
    yaml_content=$(awk '/^---$/{if(++count==2) exit; next} count==1' "$agent_file")

    if [ -z "$yaml_content" ]; then
        echo "❌ FAILED - No YAML frontmatter found"
        errors=$((errors + 1))
        continue
    fi

    # Try Ruby (built-in on macOS), then Python, then basic checks
    if command -v ruby &> /dev/null; then
        if echo "$yaml_content" | ruby -ryaml -e "YAML.safe_load(STDIN.read)" 2>/dev/null; then
            echo "✅ OK"
        else
            echo "❌ FAILED - Invalid YAML"
            echo "$yaml_content" | ruby -ryaml -e "YAML.safe_load(STDIN.read)" 2>&1 | sed 's/^/    /'
            errors=$((errors + 1))
        fi
    elif command -v python3 &> /dev/null && python3 -c "import yaml" 2>/dev/null; then
        if echo "$yaml_content" | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)" 2>/dev/null; then
            echo "✅ OK"
        else
            echo "❌ FAILED - Invalid YAML"
            echo "$yaml_content" | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)" 2>&1 | sed 's/^/    /'
            errors=$((errors + 1))
        fi
    else
        # Fallback: basic check for common YAML issues
        if echo "$yaml_content" | grep -E '^description: [^"].*:.*:' >/dev/null; then
            echo "⚠️  WARNING - Unquoted description with colons"
            errors=$((errors + 1))
        else
            echo "✅ OK (basic check)"
        fi
    fi
done

if [ $errors -gt 0 ]; then
    echo ""
    echo "❌ Validation failed with $errors error(s)"
    echo ""
    echo "Common fixes:"
    echo "  - Quote description fields that contain colons: description: \"...\""
    echo "  - Escape quotes inside quoted strings: \\\"text\\\""
    exit 1
fi

echo ""
echo "✅ All agents validated successfully"
