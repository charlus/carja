# Design System: [Product Name]

> The visual identity of this product. Every new screen follows it. The values live in code (see **Tokens**). This file holds the roles, the rules and the reasons. Maintained with `.agents/skills/design-system/SKILL.md`.

## Visual Theme & Atmosphere

[The mood in two or three sentences: dense or airy, calm or energetic, playful or serious, and why it suits the main character. The principles every screen follows.]

## Colour Palette & Roles

| Name | Token | Value | Role |
|------|-------|-------|------|
| [Deep Ocean Blue] | [--color-primary] | [#0077B6] | [Primary actions only, one per screen] |

## Typography

| Use | Font | Size / line height | Weight |
|-----|------|--------------------|--------|
| [Page title] | [Inter] | [28/36] | [600] |

## Layout & Spacing

[Base unit and scale, grid, breakpoints, maximum content width, how dense lists and forms are.]

## Component Styling

### [Component]
- **Use when:** [...]
- **Do not use when:** [...]
- **States:** empty, loading, error, disabled, hover, focus: [how each looks]

## Patterns

### [Pattern, e.g. Editing a record]
- **How:** [e.g. The page opens in its read state. An Edit button switches the section to inputs. Save and Cancel sit at the end of the section. Saving shows a confirmation and returns to the read state.]
- **Also:** [forms open on an action, destructive actions confirm, a disabled button looks disabled and says why]

## Data Display

- **Dates:** [e.g. 6 Oct 2026; DD/MM/YYYY in inputs]
- **Numbers and money:** [e.g. € 1 250, thousands separated by a space]
- **Unknown and empty:** [e.g. "Unknown" in muted text, never "No", "0" or a default answer]

## Brand Assets

- **Logo:** [path]
- **Icons:** [set and path]
- **Images and illustrations:** [style, path]

## Reference Screens

[Existing screens that embody this system, to match when building a new one: `/capability-map` for dashboards, ...]

## Tokens

[The file that holds the values, e.g. `tailwind.config.ts` or `src/styles/tokens.css`. It wins over this document if they differ.]

## Other Notes

[Accessibility targets (WCAG AA minimum), motion rules, known inconsistencies to remove.]
