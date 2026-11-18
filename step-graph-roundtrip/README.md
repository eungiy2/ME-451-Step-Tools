# STEP → graph → STEP round trip

A small, dependency-free toolchain that turns an ISO-10303-21 (STEP) B-rep into a
JSON graph, and turns that graph back into a valid STEP file.

```
 part.stp ──step_graph_export.py──▶ part.graph.json ──step_graph_rebuild.py──▶ part.rebuilt.stp
                                     part.face-adjacency-matrix.csv                  │
                                     part.face-adjacency-weighted.csv                │
                                                                                     ▼
                                            re-export the rebuilt file and compare the graphs
```

Both scripts use only the Python standard library: no CAD kernel, no OpenCascade,
no third-party packages. The exporter reads the STEP text directly; the
reconstructor writes a fresh AP242 file from the graph.

## Requirements

* Python 3.9+ (tested on 3.13)
* That's it. There is nothing to install.

## Quick start

```bash
python step_graph_export.py examples/10cm3_cube.step
python step_graph_rebuild.py examples/10cm3_cube.graph.json
```

The first command writes `examples/10cm3_cube.graph.json` and the two
face-adjacency CSVs next to the input. The second writes
`examples/10cm3_cube.rebuilt.stp`.

Export to a separate folder, then rebuild with explicit paths:

```bash
python step_graph_export.py my_part.stp -o out
python step_graph_rebuild.py out/my_part.graph.json out/my_part.rebuilt.stp
```

## What the exporter produces

| output | contents |
|---|---|
| `<part>.graph.json` | `graphVersion: 2` graph: `source`, `summary`, `nodes`, `edges`, `geometry` |
| `<part>.face-adjacency-matrix.csv` | 0/1 matrix, one row/column per face |
| `<part>.face-adjacency-weighted.csv` | same matrix, weighted by dihedral angle |

The graph carries:

* **Topology** — `Face` nodes and `Adjacency` edges between faces that share an
  edge, with the shared curve type, dihedral angle and `convex` / `concave` /
  `flat` classification.
* **PMI** — `Datum`, `DatumReferenceFrame`, `GeometricTolerance` and `Dimension`
  nodes, with the full shape-aspect / `GEOMETRIC_ITEM_SPECIFIC_USAGE` chain that
  links each item to the faces it applies to.
* **Geometry** — vertices, edges, curves, surfaces, faces and shells in the
  file's own units (`source.lengthUnit`, `source.scaleToMillimeters`), including
  B-spline control points, knots, multiplicities and weights.
* **Summary** — face/edge/vertex/shell counts, edge incidence (manifold / seam /
  non-manifold), surface-type histogram and Euler–Poincaré genus.

Geometry recognised by the exporter and written back by the reconstructor:

| category | types |
|---|---|
| surfaces | `PLANE`, `CYLINDRICAL_SURFACE`, `CONICAL_SURFACE`, `SPHERICAL_SURFACE`, `TOROIDAL_SURFACE`, `B_SPLINE_SURFACE(_WITH_KNOTS)`, rational B-spline |
| curves | `LINE`, `CIRCLE`, `ELLIPSE`, `B_SPLINE_CURVE_WITH_KNOTS`, rational B-spline |

## What the reconstructor writes

A new AP242 STEP file with the same B-rep topology, the same geometry and the
same semantic PMI as the graph. Entity numbering is regenerated from scratch;
no id is reused and no reference is left dangling.

```bash
python step_graph_rebuild.py part.graph.json [out.rebuilt.stp] [--preserve-ids]
```

* `out` defaults to `<graph base>.rebuilt.stp` next to the graph.
* `--preserve-ids` reuses the original STEP entity ids for the B-rep core.

Anything the graph does not carry (for example presentation/annotation geometry,
or PMI items with no topology link) is **neglected, not invented**: the affected
face or edge is dropped and reported on stdout, so the output never contains a
placeholder.

## Round-trip verification

The check is: export → rebuild → export again, then compare the two graphs. For
the three files below the face set, the surface-type assignment, every
`Adjacency` edge (pair, curve type, convexity) and every geometry table length
came back identical:

| sample | faces | adjacency edges | result |
|---|---:|---:|---|
| `examples/10cm3_cube.step` (AP203) | 6 | 12 | identical |
| `nist_ctc_05_asme1_ap203` (cones, 156 faces) | 156 | 331 | identical |
| `nist_ftc_10_asme1_ap242-e2` (264 faces, PMI) | 264 | 799 | identical |
| `nist_stc_07_asme1_ap242-e3` (inches, B-splines, 304 faces) | 304 | 865 | identical |

PMI node ids change on rebuild, as expected, because entity numbering is
regenerated; every PMI item that survives keeps its target faces and values.

## Library use

```python
import step_graph_export
import step_graph_rebuild

result = step_graph_export.main("part.stp", "out")   # returns paths + graph dict
step_graph_rebuild.rebuild(result["graph"], "out/part.rebuilt.stp")
```

`step_graph_rebuild.rebuild_object(...)` additionally returns the rebuilder, whose
`.skipped` record lists neglected faces, edges and the reason.

## Limitations

* **Analytic + B-spline geometry only.** Surface or curve types the exporter does
  not model are skipped and reported; they are never guessed.
* **Tessellated-only sources** (files with no B-rep, only `TESSELLATED_SOLID`)
  are reported as such in `summary.representation`; the exporter records the
  triangle pools but there is no B-rep to rebuild.
* **Presentation geometry is not round-tripped.** Semantic PMI is; graphical PMI,
  colours, layers and annotations are not.
* **One part per file.** The exporter selects the shells that belong to the
  solid (`MANIFOLD_SOLID_BREP` / `BREP_WITH_VOIDS`) and falls back to a surface
  model, then to every shell. Assemblies with multiple product definitions are
  not merged.

## Layout

```
step_graph_export.py     STEP  -> graph JSON + adjacency matrices
step_graph_rebuild.py    graph JSON -> STEP
examples/10cm3_cube.step small AP203 sample used by the quick start
```

## Provenance

Extracted from the ME 451 STEP tools project, where this round trip was run over
23 AP203/AP242 NIST test parts (CTC/FTC/STC, mm and inch, up to ~640 faces,
including PMI and B-spline surfaces) with no divergent round trips.
