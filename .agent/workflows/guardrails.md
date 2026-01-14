---
description: prevent accidental code deletion and ensure structural integrity during edits
---

To ensure that no code is unintentionally deleted or broken during complex edits, follow these guardrails:

1. **Structural Snapshot**: Before applying any `replace_file_content` or `multi_replace_file_content` call, use `view_file_outline` to identify all functions and classes in the target file.
2. **Critical Function Check**: Explicitly note the line ranges of critical functions that are *near* or *within* the intended edit range but should NOT be modified.
3. **Chunk Verification**: For each replacement chunk, verify that the `TargetContent` exactly matches the existing code and that the `ReplacementContent` does not truncate trailing braces or accidentally delete adjacent functions.
4. **Post-Edit Validation**: Immediately after the edit, run `view_file_outline` again. Compare the output with the pre-edit snapshot to ensure all intended functions still exist and no "phantom" deletions occurred.
5. **Consistency Audit**: If a function was relocated or refactored, verify that all references to it in the same file or project are still valid.
6. The "Component Call, Not Code" Rule
"When moving UI elements or features, never duplicate source code logic or helpers. Always reuse the existing shared Component. If the component's layout doesn't perfectly fit the new location, refactor the Component (adding parameters like hideContainer, style, or isCompact) instead of rewriting the logic inline."
7. Mandatory DRY Audit
"Before performing any UI change, search the codebase for the strings, logic, or data processing involved. If it exists elsewhere, you must refactor it into a shared utility or keep it in its original component. Any duplication of business logic is a failure."
8. Refactor Over Rewrite
"If an existing component is 'too bulky' for a new location, your first instinct must be to make that component more flexible via initializers, not to create a 'lite' version of it or paste its code elsewhere."
