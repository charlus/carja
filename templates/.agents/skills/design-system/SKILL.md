---
name: design-system
description: "Create, extract or maintain DESIGN.md, the one file that keeps a product's UI coherent: visual theme, colour roles, typography, layout, component styling, brand assets, and where the token values live. Use at the end of the UX/UI Design Brief, before the first UI task in Build when DESIGN.md is missing, and whenever a screen needs a pattern DESIGN.md does not cover."
category: core
---

# Design System (DESIGN.md)

> A screen built in month six must look like it belongs with the screens of month one. Code holds the values, but not the decisions: which colour has which role, which component to use when, and why. DESIGN.md holds the decisions. Every agent that builds UI reads it first.

## Where it lives

`DESIGN.md` at the root of the **code repository**: the nested repository in the outer layout, otherwise the project root. It travels with the code, so a teammate or a harness that never sees `carja/` still finds it. One file per code repository. Do not split it. An install whose outer layout holds several code repositories (a public site and a CMS, say) has one DESIGN.md in each: different products, different audiences, different designs. `carja personas` hands the Designer the one of the repository a change touches, and `carja design migrate --repo <path>` says which one receives the old notes.

## The structure

Use `carja/5-templates/design-md.md`. Its sections, in order: Visual Theme & Atmosphere · Colour Palette & Roles · Typography · Layout & Spacing · Component Styling · Patterns · Data Display · Brand Assets · Reference Screens · Tokens · Other Notes.

A philosophy is not a system. "Restraint" and "progressive density" do not tell an agent how wide a page is, how a record is edited, or how a date is written. Each section states rules an agent can follow and a reviewer can check.

- **Name, value, role, reason.** "Deep Ocean Blue (`--color-primary`, #0077B6): primary actions only, one per screen, because a single strong accent keeps the hierarchy clear." Not "blue".
- **Values live once, in code.** The **Tokens** section names the file that holds them (Tailwind config, CSS variables, theme file). DESIGN.md quotes a value to describe it, and the token file wins if they differ. Before the token file exists, DESIGN.md holds the values, and the first UI task creates the token file from them.
- **Components by use, not by list.** For each component: when to use it, when not to, its states (empty, loading, error, disabled, hover, focus). One implementation per component: a second badge is a defect.
- **Patterns** say how recurring interactions work: editing a record (read state first, then Edit), forms, confirmation, disabled actions.
- **Data Display** fixes formats: dates, numbers, money, and how an unknown or empty value is shown. An unknown is never shown as a default answer.
- **Reference Screens** name the existing screens that embody the system, so a new screen has something to match.

## Three ways in

**Greenfield (UX/UI Brief, Phase 8).** Propose the full system from the brief's screens, the Main Character and the product's tone, using `.agents/skills/frontend-design/SKILL.md` for colour, type and layout decisions. Lead with a complete draft (`.agents/skills/collaborative-drafting/SKILL.md`).

**Brownfield (code exists, no DESIGN.md).** Extract, do not invent. Read the token file, global stylesheets, the component library configuration, and 3 to 5 representative screens. Describe what is there, with the role each value plays. Where the code is inconsistent (four greys used for body text), propose one choice and list the others as debt in **Other Notes**. Name the most coherent existing screens under **Reference Screens**.

**Migration (an old `carja/4-context/design/` folder).** Run `carja design migrate`. When the folder holds only the untouched templates it writes nothing: use the brownfield mode instead. It writes DESIGN.md from the old files, drops untouched template sections, and turns each old file into a pointer. Then rewrite each migrated section into the format above, and delete placeholder rows the old template left (`#000000`, "(e.g., …)").

## Who decides

Look and feel is what the user sees, so the product owner approves DESIGN.md: one convergence, the whole draft at once. After that, an addition that follows the existing system (a new component variant in the existing style) is an engineering decision: make it and report it in one line. A change to the theme, a colour role or the typography goes back to the product owner.

## Keeping it current

A screen that needs a pattern DESIGN.md does not cover adds it to DESIGN.md **in the same change**. The Designer persona's Review Lens checks this. A pattern that lives only in code is the start of drift.
