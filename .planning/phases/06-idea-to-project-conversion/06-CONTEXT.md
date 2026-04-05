# Phase 6: Idea-to-Project Conversion - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Allow idea author or admin to convert an idea into a project, carrying over sats pool, team members, and creating bidirectional links.

</domain>

<decisions>
## Implementation Decisions

### Conversion API
- **D-01:** POST /api/ideas/:id/convert (requireAuth, author or admin only)
- **D-02:** Creates a new project row with: name = idea.title, description = idea.description (pre-filled), builder = author name, user_id = idea.user_id, total_sats_received = idea.total_sats_received
- **D-03:** Copies all idea_members as project contributors (if a project contributors mechanism exists, otherwise store in project description or a new link)
- **D-04:** Sets idea.converted_to_project_id = new project ID (new column on ideas table, migration v012)
- **D-05:** Sets project.source_idea_id = idea ID (new column on projects table, migration v012)

### Idea State After Conversion
- **D-06:** Idea stays visible in The Foyer bubble view with a "Converted" badge
- **D-07:** Voting and zapping remain open on the converted idea (no freeze)
- **D-08:** Convert button hidden once converted. Shows link to the project instead.

### Frontend
- **D-09:** On idea detail page: Convert button visible to author and admins. Opens a confirmation modal showing what will be carried over (title, description, sats, team members). User can edit the project name before confirming.
- **D-10:** After conversion, idea detail page shows "Converted to project: [name]" link
- **D-11:** On project detail page: if source_idea_id exists, show "Born from idea: [title]" link back

### Visual
- **D-12:** Converted idea bubbles get a subtle visual indicator (checkmark badge or different border color)

### Claude's Discretion
- Exact modal layout for conversion confirmation
- Whether to show a success toast or redirect to the new project after conversion

</decisions>

<canonical_refs>
## Canonical References

### Project creation pattern
- `server.js` POST /api/projects — existing project creation endpoint to study
- `server.js` projects table schema — fields to populate

### Idea detail
- `public/foyer-detail.html` — add convert button and post-conversion link

### Project detail
- `public/project.html` — add "Born from idea" back-link

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- uniqueSlug() for project slug generation
- stmts.getIdeaById for idea lookup
- idea_members table already has the team data

### Integration Points
- New migration v012: add converted_to_project_id on ideas, source_idea_id on projects
- New endpoint POST /api/ideas/:id/convert
- Update GET /api/ideas/:id to include converted_to_project_id
- Update foyer-detail.html for convert button + link
- Update foyer.html bubble rendering for converted badge
- Update project.html for back-link

</code_context>

<specifics>
No specific requirements beyond the decisions above.
</specifics>

<deferred>
None. This completes v1.
</deferred>

---

*Phase: 06-idea-to-project-conversion*
*Context gathered: 2026-04-05*
