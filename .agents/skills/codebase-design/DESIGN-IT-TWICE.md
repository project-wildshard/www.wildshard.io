# Design it twice

When Jake wants alternative interfaces for a chosen candidate. From
Ousterhout: your first idea is unlikely to be the best. Vocabulary and
fit rules: [SKILL.md](SKILL.md); dependency categories:
[DEEPENING.md](DEEPENING.md).

## 1. Frame the problem

Show Jake the constraints, the dependencies and their categories, the
side it lands on, and the budget it runs under, with a rough sketch to
make them concrete. Then carry on to step 2 while he reads.

## 2. Spawn three subagents

Three at most, in the background, each with a fresh context
(no forks, caps in the brief, no
`set-label.sh`). Each brief carries the file paths, the coupling, the
dependency category, what sits behind the seam, SKILL.md's Fit section
and one constraint:

- **Smallest**: one to three entry points, maximum leverage per entry.
- **Common caller**: the default case is trivial.
- **Hot path**: zero allocations per tick, the cheapest call shape
  that still holds the seam.

Each returns the interface (types, invariants, ordering, error modes,
cost per frame), a usage example, what hides behind the seam, its
adapters, and where its leverage is thin.

## 3. Compare

Give each design in turn, then compare in prose on **depth**,
**locality**, **seam placement**, frame cost and fit: which lint or
ratchet it touches, and whether any count rises. Reject a design that
breaks Fit, whatever else it wins. Then recommend one, or a hybrid,
and say why. Jake wants a strong read, not a menu.
