# KDE Knowledge Document Validation Specification

**Document ID**: KDE-KNOWLEDGE-VAL-SPEC-001
**Title**: Knowledge Document Validation Specification
**Version**: 1.0.0
**Status**: APPROVED
**Confidence**: HIGH
**Class**: ARCHITECTURE
**Author**: KDE Governance
**Authority**: IMPLEMENT-001
**Effective Date**: 2026-07-21
**Approved By**: KDE Governance
**Promoted**: 2026-07-21

---

## Purpose

This document specifies the validation rules for KDE Knowledge Documents. It defines how KDE Runtime validates Knowledge Documents for compliance with the Knowledge Document Specification.

---

## Overview

The validation system checks Knowledge Documents for:
- Metadata completeness
- Required sections
- Lifecycle validity
- Provenance integrity
- Evidence references
- Cross-reference validation
- Taxonomy compliance

Validation is **read-only** — the system reports non-compliance without modifying documents.

---

## Validation Levels

| Level | Description | When Applied |
|-------|-------------|--------------|
| **Metadata** | Check required metadata fields | All documents |
| **Structure** | Check required sections | All documents |
| **References** | Validate cross-references | All documents |
| **Provenance** | Check provenance chain | CANDIDATE+ |
| **Compliance** | Full specification check | PROMOTED |

---

## Validation Rules

### Metadata Validation

| Field | Required | Validation Rule |
|-------|----------|-----------------|
| id | Yes | Must match pattern KDE-XXX or domain-specific |
| title | Yes | Non-empty string |
| class | Yes | One of: FOUND, ARCH, DOMAIN, GOV, ARG |
| version | Yes | Semantic version format (X.Y.Z) |
| status | Yes | One of: DRAFT, CANDIDATE, VALIDATED, PROMOTED, DEPRECATED |
| confidence | Yes | One of: LOW, MEDIUM, HIGH |
| evidence-level | Yes | Integer 1-5 |
| owner | Yes | Non-empty string |
| created | Yes | ISO8601 timestamp |
| updated | Yes | ISO8601 timestamp |
| reviewed | Yes | YYYY-MM-DD date |
| source-investigation | Yes | INV-XXX format |
| evidence | Yes | Array with at least one item |
| approver | Conditional | Required when status = PROMOTED |
| domain | Conditional | Required when class = DOMAIN |
| valid-until | No | YYYY-MM-DD date |
| external-source | No | Array of {name, url, citation} |

#### Metadata Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| META-001 | Missing required field: {field} | ERROR |
| META-002 | Invalid field value: {field} = {value} | ERROR |
| META-003 | Invalid date format: {field} | ERROR |
| META-004 | Missing conditional field: {field} | ERROR |
| META-005 | Evidence array is empty | ERROR |

### Structure Validation

| Section | Required For | Validation Rule |
|---------|-------------|-----------------|
| Definition | FOUND, ARCH, GOV, ARG | Non-empty section |
| Overview | DOMAIN | Non-empty section (allowed alternative to Definition) |
| Summary | ALL | Non-empty section |
| Evidence | ALL | Contains evidence table |
| Provenance | ALL | Contains provenance chain |
| Confidence Assessment | ALL | Contains confidence table |

#### Structure Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| STR-001 | Missing required section: {section} | ERROR |
| STR-002 | Section is empty: {section} | ERROR |
| STR-003 | Section contains prohibited content | WARNING |

### Reference Validation

| Check | Validation Rule |
|-------|-----------------|
| Knowledge ID | Referenced IDs must exist |
| Investigation ID | Referenced IDs must exist |
| Evidence ID | Referenced IDs should exist |
| Cross-references | Links must be valid |

#### Reference Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| REF-001 | Broken reference: {id} does not exist | ERROR |
| REF-002 | Orphan reference: {id} not linked from any document | WARNING |

### Provenance Validation

| Check | Validation Rule |
|-------|-----------------|
| Investigation link | Must link to source investigation |
| Evidence links | Must have at least one evidence reference |
| Validator | Validator name required for VALIDATED+ |
| Approver | Approver name required for PROMOTED |
| Promotion date | Required for PROMOTED |

#### Provenance Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| PROV-001 | Missing investigation reference | ERROR |
| PROV-002 | Missing evidence references | ERROR |
| PROV-003 | Missing validator name | ERROR |
| PROV-004 | Missing approver (required for PROMOTED) | ERROR |
| PROV-005 | Missing promotion date (required for PROMOTED) | ERROR |

### Lifecycle Validation

| Check | Validation Rule |
|-------|-----------------|
| Valid states | Status must be valid state |
| State transitions | Must follow valid transitions |
| Required approvals | PROMOTED requires human approval |
| Deprecation | Deprecated docs must have superseded-by |

#### Lifecycle Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| LIFE-001 | Invalid status: {status} | ERROR |
| LIFE-002 | Invalid state transition: {from} → {to} | ERROR |
| LIFE-003 | Human approval missing for PROMOTED | ERROR |

### Taxonomy Validation

| Check | Validation Rule |
|-------|-----------------|
| Class | Class must match document content |
| Domain | DOMAIN documents must specify domain |
| Naming | Filename must match class rules |

#### Taxonomy Validation Errors

| Error Code | Message | Severity |
|------------|---------|----------|
| TAX-001 | Document class mismatch | WARNING |
| TAX-002 | Domain not specified for DOMAIN class | ERROR |
| TAX-003 | Invalid filename for class {class} | WARNING |

---

## Validation Report

The validation system produces a report for each document:

```yaml
validation_report:
  document_id: KDE-XXX
  timestamp: YYYY-MM-DDTHH:MM:SSZ
  overall_status: [PASS|FAIL|WARNING]
  
  checks:
    metadata:
      status: [PASS|FAIL|WARNING]
      errors: []
      
    structure:
      status: [PASS|FAIL|WARNING]
      errors: []
      
    references:
      status: [PASS|FAIL|WARNING]
      errors: []
      
    provenance:
      status: [PASS|FAIL|WARNING]
      errors: []
      
    lifecycle:
      status: [PASS|FAIL|WARNING]
      errors: []
      
    taxonomy:
      status: [PASS|FAIL|WARNING]
      errors: []
```

---

## Validation Summary

### Overall Status

| Status | Meaning |
|--------|---------|
| **PASS** | All checks passed |
| **WARNING** | Non-blocking issues found |
| **FAIL** | Blocking issues found |

### Severity Levels

| Level | Meaning | Blocks Promotion |
|-------|---------|------------------|
| **ERROR** | Must fix | Yes |
| **WARNING** | Should fix | No |

---

## Implementation Notes

### Validation Trigger

Validation runs:
1. On document creation
2. On document edit
3. Before state transition
4. On repository scan

### Reporting

Validation reports:
1. Display in console
2. Written to validation log
3. Available via API

### Non-Compliance Handling

When validation fails:
1. Report errors to user
2. Do NOT modify document
3. Block invalid state transitions
4. Allow viewing of invalid documents

---

## References

| Document | Relationship |
|----------|--------------|
| KDE-KNOWLEDGE-DOCUMENT-SPECIFICATION.md | Parent specification |
| KDE-KNOWLEDGE-LIFECYCLE.md | Lifecycle rules |
| KDE-KNOWLEDGE-TAXONOMY.md | Taxonomy rules |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-07-21 | Initial validation specification |

---

**Document Status**: APPROVED
**Authority**: IMPLEMENT-001
**Compliance**: MANDATORY
