# Canonical Workflow (Figma × AI × GitHub)

## Purpose
This document defines the single, canonical workflow for this org.
The goal is: PR → Issue → Figma → Decision must always be traceable.

## Canonical Flow
1. Create a GitHub Issue
   - Must include: Figma URL, AI thread URL, Acceptance Criteria
2. AI planning / design
   - Use the Issue as the input source of truth
   - Final decisions must be written back to the Issue (Decision section)
3. Update Figma
   - Frame naming: `[#<issue>] <screen>/<state>`
   - Frame description must include the Issue URL
4. Implement in GitHub via PR
   - PR body must include:
     - `Fixes #<issue_number>`
     - Figma URL
     - Acceptance Criteria checklist (checkboxes)
5. Review & Merge
   - Review comments remain in PR
   - Merge only when Acceptance Criteria are satisfied

## Non-negotiables
- No work starts without an Issue
- No merge without PR Gate passing
- No “decisions only in chat”
  - Every decision must be reflected in the Issue

## Artifacts (where things live)
- Requirements / Acceptance Criteria: GitHub Issue
- Decisions: GitHub Issue (Decision section)
- Design source: Figma (linked to Issue)
- Implementation source: GitHub PR / code
- Review history: GitHub PR
- Phase2 enforcement design (RBAC / Vault / Audit): `docs/ai/core/phase2-integration-hub.md`
