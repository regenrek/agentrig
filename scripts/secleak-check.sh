#!/usr/bin/env bash
# Security leak check script for agentrig
# Runs gitleaks and trivy for local security scanning
#
# Usage: ./scripts/secleak-check.sh
#
# Prerequisites:
#   brew install gitleaks trivy  (macOS)
#   or see https://github.com/gitleaks/gitleaks and https://trivy.dev

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== agentrig Security Check ===${NC}\n"

ERRORS=0

# Check for gitleaks
if command -v gitleaks &> /dev/null; then
  echo -e "${YELLOW}Running gitleaks...${NC}"
  GITLEAKS_ARGS=(git --no-banner --redact=100)
  if [ -f .gitleaks.toml ]; then
    GITLEAKS_ARGS+=(--config .gitleaks.toml)
  fi
  GITLEAKS_ARGS+=(.)
  if gitleaks "${GITLEAKS_ARGS[@]}"; then
    echo -e "${GREEN}✓ gitleaks: No secrets detected${NC}\n"
  else
    echo -e "${RED}✗ gitleaks: Secrets detected!${NC}\n"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${YELLOW}⚠ gitleaks not installed, skipping. Install: brew install gitleaks${NC}\n"
fi

# Check for trivy
if command -v trivy &> /dev/null; then
  echo -e "${YELLOW}Running trivy secret scan...${NC}"
  if trivy fs --scanners secret,misconfig --exit-code 1 --quiet .; then
    echo -e "${GREEN}✓ trivy secrets: No issues${NC}\n"
  else
    echo -e "${RED}✗ trivy: Secret/misconfig issues detected!${NC}\n"
    ERRORS=$((ERRORS + 1))
  fi

  echo -e "${YELLOW}Running trivy vulnerability scan (HIGH/CRITICAL)...${NC}"
  if trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --quiet .; then
    echo -e "${GREEN}✓ trivy vulns: No HIGH/CRITICAL vulnerabilities${NC}\n"
  else
    echo -e "${RED}✗ trivy: Vulnerabilities detected!${NC}\n"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo -e "${YELLOW}⚠ trivy not installed, skipping. Install: brew install trivy${NC}\n"
fi

# Summary
echo -e "${YELLOW}=== Summary ===${NC}"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All security checks passed${NC}"
  exit 0
else
  echo -e "${RED}✗ $ERRORS security check(s) failed${NC}"
  exit 1
fi
