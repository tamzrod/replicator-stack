# Laboratory Templates

**Purpose**: Standard templates for creating laboratory artifacts

## Templates Available

| Template | Purpose | File |
|----------|---------|------|
| Investigation | Research phase artifact | `investigation.md` |
| Experiment | Laboratory phase artifact | `experiment.md` |
| Evidence | Document findings | `evidence.md` |
| Validation | Verify results | `validation.md` |

## Usage

Copy a template and rename for your artifact:

```bash
cp templates/investigation.md investigations/INV-001/PROPOSAL.md
cp templates/experiment.md experiments/LAB-001/PLAN.md
```

## Template Fields

### Investigation Template
- ID, Title, Status
- Question
- Hypothesis
- Investigation Plan
- Findings
- Evidence Links

### Experiment Template
- ID, Title, Status
- Design
- Execution Log
- Results
- Analysis
- Evidence

### Evidence Template
- ID, Source
- Evidence Category
- Citation
- Content
- Integrity Hash

### Validation Template
- ID, Target Artifact
- Validation Checks
- Reproducibility Check
- Results
- Status Recommendation

## Source

This structure follows the Scientific Learning Loop defined in SEED-001.
