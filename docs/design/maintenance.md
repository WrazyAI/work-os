# Maintaining the design guides

**Use when:** Adding, moving, or changing design guidance itself.

## Ownership and precedence

The [main design index](../../design.md), [shared foundations](foundations.md),
focused guides, and applicable [design exceptions](../design-exceptions.md)
together form the current design contract. A guide's **Owns** field identifies
the authoritative home for its topic.

Follow the current approved task brief. Preserve the shared foundations and
the affected guide's more specific contract; an explicit surface exception
applies only to that surface. Generic external design advice informs decisions
within those boundaries. If implementation and guidance disagree, inspect the
current source and approval history, identify the difference, and resolve it
explicitly. Existing code alone does not authorize a new product rule.

Dated specs, plans, research, screenshots, and verification reports are evidence
of the work they describe. They are not an instruction to restore superseded
layouts. Use the [legacy section lookup](legacy-sections.md) for old references;
use Git history when a reference predates that lookup's baseline.

## Where a new rule belongs

| Rule | Canonical home |
|---|---|
| Product character or a universal design principle | `foundations.md` |
| Color, typography, geometry, elevation | `tokens.md` |
| One screen, workflow, or product area | The matching `areas/` or `admin/` guide |
| A genuinely shared interaction | The matching `patterns/` guide |
| State ownership or performance budget | `implementation.md` |
| Rendered evidence or handoff requirements | `verification.md` |
| A newly approved, scoped exception | Owning guide and `../design-exceptions.md` as appropriate |

Change the owning file and link to it from consumers. Do not repeat token
tables, review gates, or whole feature contracts in every area guide. A brief
reminder of a safety or truth boundary can remain at the point of use.

## File shape and reading cost

Use this shape for a focused guide:

```markdown
# Specific area or pattern

**Use when:** The task triggers that select this guide.

**Owns:** The requirements maintained here.

**Requires:** Shared foundations; another short guide only if always necessary.

**Read next only if:**

- Changing a named behavior: link to its owning guide.

**Implementation starting points:** Existing relevant source files.

## Named contract

The actual requirements, including exceptions and relevant states.
```

Keep the root index a router. A focused guide should usually fit in roughly
40–180 lines; the responsibility boundary matters more than an arbitrary count.
Split a guide when one kind of change regularly requires skipping most of it.
Avoid tiny files that can only be understood by loading all their siblings.

**Requires** is the only unconditional dependency field. Keep that dependency
graph acyclic and shallow: area → shared foundation/pattern, never foundation →
all areas. **Read next only if** links are conditional. Ordinary links,
implementation pointers, and return-to-index links are navigation, not loading
instructions. Do not introduce wildcard imports, concatenation, or a generated
all-guides prompt.

## Before committing a documentation change

1. Follow a few representative tasks through the index, including a small local
   change and a shared-component change. Confirm the selected files are sufficient.
2. Check relative links and heading fragments. Prefer stable named headings over
   numbered sections or source line numbers.
3. Check that moved requirements, numeric limits, approval boundaries, and scoped
   exceptions still have an explicit owner. Update routing and the legacy lookup
   when moving a previously mapped topic.
4. Keep `AGENTS.md` and `README.md` entry points consistent. The old instruction
   to read the whole blueprint must not return through a new prompt/template.
5. Run `git diff --check` and the existing surface guard. For documentation-only
   work, these checks establish documentation integrity; they do not establish
   visual acceptance of a UI change.
