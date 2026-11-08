# Natural stat growth

`#/calculators/stat-growth` graphs HP, MP, Strength, Defense, Wisdom, Spirit and Speed
for any of the sixteen playable forms. The graph always covers levels 1–999.
A second form can be compared over that full span. Inspect level, the keyboard-accessible
slider and dragging the vertical graph marker update the seven stat cards, which show exact
totals and the increase on reaching the selected level. The level input clamps to 1–999; an empty input
uses level 1 and returns to 1 when focus leaves. Level 1 is the starting value, with no
level gain.

Hovering over the graph leaves the selected level unchanged. The marker has a wider
invisible grab area and captures the pointer while dragging, including outside the plot.

The X-axis labels use 100-level intervals, with levels 1 and 999 at the ends.
The Y-axis uses rounded steps (such as 250, 500 or 25,000) and rounds its upper
limit up to fit both forms. Plotted stats and inspected values retain their exact totals.

The viewer shows natural base stats. Equipment, permanent upgrades (XData and plugs),
and temporary effects are excluded. It uses the loaded disc's form names, starting
values and growth coefficients; it bundles no character data. Missing fields in older
browser exports show a re-import notice instead of inferred values.

## Arithmetic

`src/data/stat-growth.ts` holds the two shared retail curves. HP/MP use a different
factor from the five attributes. Both select the first band with ceiling >= level:

```
factor = offset + rate * (level - origin)
base = min(cap, initial + truncate(growth * factor / 100))
gain(level) = base(level) - base(level - 1)
```

The cap is 99,999 for HP/MP and 9,999 for attributes. Multiplication retains signed
32-bit behavior, as in the existing character calculator. Attribute calculation is
shared with `character-stats.ts`, including its permanent-upgrade addition, so the
viewer and existing calculators cannot drift onto different level curves. Natural
growth passes an upgrade value of zero. Input levels must be integers from 1 to 999.

Retail PS2 USA evidence: HP/MP helper `0x003fa3b0`, attribute helper `0x003fa850`,
and the six parallel curve tables at `0x004cf130` through `0x004cf220`. The decomp's
`docs/systems/techniques.md` records all ten used bands. Stat recomputation is
deterministic; there are no random growth rolls. Rounding and caps are applied to
each total before computing a level gain.

Importer 1.27.0 exports all seven initial/growth pairs from `shinka`; see the
[schema](schema.md). Unit tests cover every curve boundary, differing form coefficients,
rounding, caps, invalid input, missing data and field extraction. The optional disc
and region tests check all seven pairs from real imports and validate the schema.
