# ARCHIVED — this is not the LifeLink frontend

This directory is a superseded early UI mockup, kept only as a record of the
first design pass. **The frontend that is submitted and that works against the
API is [`../frontend/`](../frontend/).**

Do not run, grade, or build this directory. It was replaced because it was a
static shell: apart from JWT login, its tables and action buttons rendered
hard-coded preview data and never called the API. It was also built on a
TypeScript/Next-style toolchain that the project scope did not call for, and its
`db/schema.ts` is empty Drizzle scaffolding — the authoritative schema is the
plain SQL in [`../database/`](../database/).

The working frontend is documented in [`../docs/15_frontend.md`](../docs/15_frontend.md).

The original notes for this mockup remain in [LIFELINK_UI.md](LIFELINK_UI.md);
read them as history, not as instructions.
