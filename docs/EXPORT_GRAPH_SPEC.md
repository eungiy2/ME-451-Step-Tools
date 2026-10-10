# Graph Schema Specification

Schema version: `graphVersion` 1
Implementation: `src/utils/exportGraph.ts`
Export driver: `scripts/exportGraphs.ts`
Behavioural checks: `scripts/verifyExportGraph.ts`

One loaded part is emitted as a graph `G = (V, E)` in JSON. The file is
self-describing: node and edge kinds are explicit, every numeric attribute names
its unit in this document, and every attribute that could not be determined is
either `null` or carries an explicit reason. Nothing is silently dropped or
guessed.

---

## 1. Document structure

```json
{
  "graphVersion": 1,
  "source": {
    "fileName": "nist_ftc_06_asme1_ap242-e2.stp",
    "schema": "AP242",
    "fileSize": 1971192,
    "byteLength": 1971192,
    "geometryTopologySource": "occt",
    "linearDeflection": 0.02,
    "angularDeflection": 0.1,
    "lengthUnit": "mm",
    "angleUnit": "deg"
  },
  "statistics": { "...": "see section 6" },
  "nodes": [],
  "edges": []
}
```

`source.lengthUnit` and `source.angleUnit` apply to every numeric attribute in
the document unless an attribute name ends in `Deg` or `Rad`.

`geometryTopologySource` is `occt` when native OCCT topology was used and
`tessellation` when the viewer fallback path produced the geometry.

---

## 2. Node types

### 2.0 Identity

Node IDs are `<kind>:<entityId>`, disambiguated as `<kind>:<entityId>@<recordId>`
when several PMI records resolve to the same STEP entity.

This is not hypothetical. A property definition can legitimately carry more than
one dimension, and the AP203 negative control contains 14 such records across 4
STEP entities. Keying nodes on `entityId` alone collapsed those 14 distinct
records onto 4 nodes and silently lost the rest, which the negative control
exposed because an AP203 file carries no PMI at all and any PMI node there is
already suspect. Three AP242 fixtures have the same collision.

The verification asserts that every parsed PMI record yields exactly one node,
that the count matches the parser exactly, and that no two nodes share an ID.

### 2.1 Face

One node per B-Rep face. This is the substrate that a later feature-recognition
layer consumes, so face boundaries are preserved exactly as OCCT reports them.

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `runtimeId` | string | - | yes | `BRepFace-<n>`; matches the viewer and `pmiTopologyReferences` identity space. |
| `nativeIndex` | number | - | yes | Position in the whole rendered model. Matches `runtimeId` and `faceIndex`; the OCCT payload's own index is mesh-local and repeats across meshes. |
| `stepEntityIds` | string[] | - | yes | Reverse of the `faceMapping`, so a face can be traced to STEP without re-running the classifier. |
| `surfaceType` | enum | - | yes | `plane`, `cylinder`, `cone`, `sphere`, `torus`, `bezier`, `bspline`, `revolution`, `extrusion`, `offset`, `other`. |
| `area` | number \| null | mm² | yes | OCCT area-weighted surface area. `null` when OCCT did not supply it. |
| `centroid` | [x,y,z] \| null | mm | yes | Area-weighted OCCT centroid, falling back to the tessellated vertex average. |
| `bounds` | {min,max} \| null | mm | yes | Axis-aligned extents. |
| `outwardNormal` | [x,y,z] \| null | - | yes | Unit outward normal at the representative point. |
| `normalSource` | enum | - | yes | `cylinder-radial`, `tessellation`, `unavailable`. Tells the consumer how the normal was derived. |
| `normalDeviationDeg` | number \| null | deg | yes | Cylinder fit quality: worst angle between any triangle winding normal and the fitted radial. Published only when the fit is well conditioned. |
| `cylinderAxis` | [x,y,z] \| null | - | yes | Fitted axis. Published whenever the patch winds consistently, because the axis is determined by normals and stays accurate on a coarse patch. |
| `cylinderRadius` | number \| null | mm | yes | Published only when the fit is well conditioned. `null` rather than a loose number. |
| `cylinderRadiusDeviation` | number \| null | mm | yes | Max radial residual of the fit. Published together with `cylinderRadius`. |
| `cylinderOrientation` | enum \| null | - | yes | `external` (shaft-like) or `internal` (bore-like). `null` when the fit was rejected. |
| `windingConsistency` | number \| null | ratio | yes | Dominant winding fraction. Below 0.9 the face has no single outward direction. |
| `windingMinorityTriangles` | number \| null | count | yes | Triangles opposing the dominant winding. |
| `edgeCount`, `loopCount` | number | - | yes | Local topology size, for cheap adjacency reasoning. |
| `meshVertexCount`, `meshTriangleCount` | number | - | yes | Tessellation density behind the face. |
| `topologySignature` | string \| null | - | yes | Stable `occt:v1:face:<hash>` signature. Survives retessellation and renumbering. |

Rationale for the `normalSource` / trust split: the axis direction and the
radius do not degrade together. The axis comes from the patch normals and stays
accurate when a patch is coarsely faceted; the radius does not. Publishing the
axis while withholding the radius, with `cylinderOrientation: null`, keeps the
graph honest instead of reporting a radius that is several percent wrong.

### 2.2 Edge

One node per topological edge. Carries the curve classification required for
manufacturing questions such as "is this a drilled hole or a milled slot".

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `runtimeId` | string | - | yes | `BRepEdge-<n>`. |
| `nativeIndex` | number | - | yes | Position in the rendered model. |
| `curveType` | enum | - | yes | `line`, `circle`, `ellipse`, `hyperbola`, `parabola`, `bezier`, `bspline`, `offset`, `other`, `unknown`. `unknown` only in tessellation fallback. |
| `length` | number \| null | mm | yes | Exact OCCT curve length, else polyline length. |
| `closed` | boolean | - | yes | Closed curve loops. |
| `stepEntityIds` | string[] | - | yes | Matched STEP `EDGE_CURVE` identities. |
| `parentFaceIds` | string[] | - | yes | Incident faces; drives the adjacency edges. |
| `vertexIds` | string[] | - | yes | Endpoints; drives the incidence edges. |
| `startPoint`, `endPoint`, `midpoint` | [x,y,z] \| null | mm | yes | Localized geometry for anchoring. |
| `topologySignature` | string \| null | - | yes | Stable `occt:v1:edge:<hash>`. |
| `stepTopologySignature` | string \| null | - | yes | STEP-side signature, kept separate from the OCCT one. |

### 2.3 Vertex

One node per topological vertex.

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `runtimeId` | string | - | yes | `BRepVertex-<n>`. |
| `nativeIndex` | number | - | yes | Position in the rendered model. |
| `point` | [x,y,z] \| null | mm | yes | Exact OCCT point. |
| `stepEntityIds` | string[] | - | yes | Matched STEP `VERTEX_POINT` identities. |
| `topologySignature` | string \| null | - | yes | Stable signature including incident edge descriptors. |

### 2.4 Datum

A datum feature. Attached to topology by edges, never merged into faces.

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `entityId` | string | - | yes | STEP `#id` of the datum feature. |
| `identifier` | string | - | yes | Datum letter, e.g. `A`. |
| `datumType` | string | - | yes | e.g. `Primary Flat Datum Plane`. |
| `symbol` | string | - | yes | e.g. `[ A ]`. |
| `targetName` | string | - | yes | Parser description of the controlled feature. |
| `targetStepEntityIds` | string[] | - | yes | All STEP targets, including multi-face features. |
| `semanticTargetStepEntityIds` | string[] | - | yes | Semantic targets only, excluding presentation geometry. |
| `derivedDatum` | string \| null | - | yes | `medianPlane`, `twoFaceDimension`, `axis`, `multiface`. |
| `targetSource` | enum \| null | - | yes | `semantic` or `presentation`. |
| `surfaceGeometry` | object[] | mixed | yes | Per-target surface type, point, normal, axis. |
| `presentationTargetPoint` | [x,y,z] \| null | mm | yes | Leader placement, distinct from controlled geometry. |
| `unresolvedTargetStepEntityIds` | string[] | - | yes | Targets with no topology match. Never dropped. |
| `ambiguousTargetStepEntityIds` | string[] | - | yes | Targets with several matches. Never dropped. |

### 2.5 DatumTarget

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `entityId` | string | - | yes | STEP `#id`. |
| `identifier` | string | - | yes | Target identifier, e.g. `G1`. |
| `parentDatum` | string \| null | - | yes | Datum letter this target belongs to. |
| `targetType` | string \| null | - | yes | e.g. `circular curve`. |
| `targetPoint` | [x,y,z] \| null | mm | yes | Point target. |
| `targetLine` | object \| null | mm | yes | Line target: length, direction, center, normal. |
| `targetCircle` | object \| null | mm | yes | Circular target: diameter, radius, center, normal. |
| `targetCurvePointCount` | number | count | yes | Curve targets carry geometry the other shapes do not; only the count is kept to bound size. |
| `targetZone` | object \| null | mm | yes | Rectangular zone: width, length, center, normal. |
| `sizeLabels` | string[] | - | yes | Zone size qualifiers. |
| `unresolvedTargetStepEntityIds` | string[] | - | yes | Unresolved targets. |
| `ambiguousTargetStepEntityIds` | string[] | - | yes | Ambiguous targets. |

### 2.6 Dimension

A dimensional callout. Tolerance *values* live here; tolerance *zones* live on
the FCF node that owns them (section 2.7).

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `entityId` | string | - | yes | STEP `#id`. |
| `dimensionKind` | string \| null | - | yes | `linear`, `diameter`, `radius`, `size`, `threadDepth`, `chamfer`, `slot`, `angular`. |
| `targetStepEntityIds` | string[] | - | yes | STEP entities this callout controls. The basis for FCF attachment (section 3.6). |
| `nominalDimension` | number \| null | mm | yes | Nominal size. |
| `lowerLimit`, `upperLimit` | number \| null | mm | yes | Absolute limits where the file states them directly. |
| `lowerTolerance`, `upperTolerance` | number \| null | mm | yes | Signed plus/minus deviations. |
| `preModifier` | string \| null | - | yes | e.g. `2X`. |
| `decimalPlaces` | number \| null | count | yes | Display precision; distinguishes `0.05` from `0.050`. |
| `isReferenceDimension` | boolean | - | yes | Parenthetical reference call. |
| `isBasicDimension` | boolean | - | yes | Boxed theoretically-exact dimension. |
| `isStatisticalTolerance` | boolean | - | yes | Statistical tolerancing in force. |
| `isDatumTargetDimension` | boolean | - | yes | Sizes a datum target, not a feature. |
| `isSphericalDimension`, `isCircularCurveDimension`, `isControlledRadiusDimension` | boolean | - | yes | Modifier flags that change manufacturing meaning. |
| `isThreadCall`, `threadDesignation` | boolean, string \| null | - | yes | Thread callouts need the designation, not just a diameter. |
| `toleranceZoneShape` | string \| null | - | yes | Size-only zone shape for the callout. |
| `modifiers` | string[] | - | yes | Diameter symbol and similar qualifiers. |
| `secondary` | object \| null | mm | yes | Second row of a stacked dimension. |
| `compound` | object \| null | mixed | yes | `counterbore`, `countersink`, `slot`: hole size, depth, angle, slot radius. |
| `unresolvedTargetStepEntityIds` | string[] | - | yes | Unresolved targets. |
| `ambiguousTargetStepEntityIds` | string[] | - | yes | Ambiguous targets. |

### 2.7 GeometricTolerance (FCF)

A geometric tolerance and its tolerance *zone*.

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `entityId` | string | - | yes | STEP `#id`. |
| `category` | enum | - | yes | `Form`, `Orientation`, `Location`, `Profile`. Answers "what kind of control is this" without parsing the symbol. |
| `targetStepEntityIds` | string[] | - | yes | STEP entities this tolerance controls. The basis for FCF attachment (section 3.6). |
| `toleranceType` | string | - | yes | e.g. `Position`, `Flatness`, `Surface Profile`. |
| `symbol` | string | - | yes | Unicode GD&T symbol. |
| `toleranceValue` | number \| null | mm | yes | The value. |
| `toleranceZone` | object | mixed | yes | `form`, `isDiameter`, `projectedHeight`, `value`. |
| `modifiers` | string[] | - | yes | `MMC`, `LMC`, `⌀`, projected-tolerance zone, and similar. |
| `isStatisticalTolerance` | boolean | - | yes | Statistical tolerancing. |
| `hasToleranceModifiers` | boolean | - | yes | Distinguishes an explicit modifier list from an empty one. |
| `targetName` | string | - | yes | Controlled feature description. |
| `attachedDimensionEntityId` | string \| null | - | yes | The size callout this FCF is attached to. |
| `datumReferenceFrameLabel` | string \| null | - | yes | e.g. `A | B | C`. |
| `datumReferenceFrameEntityId` | string \| null | - | yes | Links to the DRF node. |
| `datumReferenceOrder` | string[] | - | yes | Convenience copy of the ordered datum list. |
| `unresolvedTargetStepEntityIds` | string[] | - | yes | Unresolved targets. |
| `ambiguousTargetStepEntityIds` | string[] | - | yes | Ambiguous targets. |

**Zones versus values.** `toleranceValue` is the number a drawing states.
`toleranceZone` is the region the number applies to: `form` names its shape
family, `isDiameter` distinguishes a cylindrical zone from a planar one, and
`projectedHeight` carries the projected-tolerance-zone modifier height. Keeping
them apart lets a consumer answer "how far may this move" without inferring zone
geometry from a value, and lets a consumer see when the file does not state the
zone at all.

### 2.8 DatumReferenceFrame

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `entityId` | string | - | yes | STEP `#id`. |
| `scope` | enum | - | yes | `model` for standalone frames, `tolerance` for an FCF-scoped frame. |
| `ownerEntityId` | string \| null | - | yes | The FCF for `scope: "tolerance"`. |
| `name`, `label` | string | - | yes | Source and display names. |
| `datumOrder` | string[] | - | yes | Ordered datum list, primary first. |
| `toleranceEntityIds` | string[] | - | yes | Tolerances governed by this frame. |
| `frameBasis` | object \| null | mm | yes | Origin and axes when the file states them. |
| `unresolvedTargetStepEntityIds` | string[] | - | yes | Unresolved targets. |
| `ambiguousTargetStepEntityIds` | string[] | - | yes | Ambiguous targets. |

---

## 3. Edge types

### 3.1 `adjacency` (face ↔ face)

One edge per shared topological edge, carrying the dihedral geometry.

| Attribute | Type | Unit | Required | Rationale |
| --- | --- | --- | --- | --- |
| `sharedEdgeIds` | string[] | - | yes | The shared edge(s) this junction comes from. |
| `convexity` | enum | - | yes | `convex`, `concave`, `flat`, `indeterminate`. |
| `dihedralAngleRad`, `dihedralAngleDeg` | number | rad, deg | yes | Material dihedral angle in `(0, 2pi)`. |
| `normalAngleRad`, `normalAngleDeg` | number | rad, deg | yes | Angle between the two outward face normals, in `(0, pi)`. |
| `patchNormalAngleDeg` | number | deg | yes | Angle between the whole-patch mean normals. Diagnostic. |
| `midpoint`, `edgeTangent` | [x,y,z] | mm | yes | Where and in which direction the junction was measured. |
| `normalSource` | [enum, enum] | - | yes | How each of the two normals was derived. |
| `nonManifold` | boolean | - | yes | More than two faces meet at this edge. |
| `convexityNote` | string \| null | - | yes | Why `indeterminate`. |

`dihedralAngleDeg` and `convexity` are consistent by construction:

- `convex` ⟹ `0 < dihedralAngleDeg < 180`
- `concave` ⟹ `180 < dihedralAngleDeg < 360`
- `flat` ⟹ `dihedralAngleDeg == 180`
- `indeterminate` ⟹ `convexityNote != null`

**Why the wing probe.** Convexity is not a two-face quantity. Writing `H_i` for
the material half-space of face `i`, a convex junction has material
`H1 ∩ H2` while a re-entrant junction has material `H1 ∪ H2`. The intersection
wedge is solid in both cases, so probing the wedge always answers "material" and
cannot separate them; no sign convention on the edge tangent or the face order
changes this. The two cases differ only in the complementary **wing**
`H1 ∩ not-H2`, which is void for the intersection case and solid for the union
case. The probe point is therefore placed in the wing, whose bisector direction
is `u2 - u1`, and tested against the whole triangulated solid by ray parity.
Ray parity requires a closed shell, so every face participates and the probe
point is offset off both adjacent planes by construction.

The probe is run at two offsets and must agree. Disagreement, or a knife-edge
ray, is reported as `indeterminate` with a reason rather than resolved by
guessing.

**Flat.** Faces whose outward normals are within `GRAPH_FLAT_ANGLE_RADIANS` of
parallel *or* antiparallel are reported as tangent-continuous. Both ends matter:
parallel normals are two coplanar patches of one plane, antiparallel normals are
two patches of the same smooth curved surface meeting at a tessellation seam.
Neither is a manufacturing corner, and a seam would otherwise be reported as a
360-degree re-entrant angle.

### 3.2 `incidence` (face → edge, edge → vertex)

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `role` | enum | yes | `face-boundary` or `edge-endpoint`. |

Present so that Edge and Vertex nodes are reachable from the graph rather than
orphaned. No PMI edge uses this route.

### 3.3 `pmi-topology` (PMI node → face/edge/vertex)

The only PMI-to-topology mapping route. Produced by
`enrichPmiTopologyReferences`; no second mapping exists.

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `entityKind` | enum | yes | `face`, `edge`, `vertex`, `loop`. |
| `targetStepEntityId` | string | yes | The STEP entity the PMI record names. |
| `resolution` | enum | yes | `resolved`, `missing`, `ambiguous`. |
| `resolutionReason` | enum | yes | Why, per the resolver contract. |
| `runtimeId` | string \| null | yes | Matched `BRep*` identity. |
| `candidateRuntimeIds` | string[] | yes | All candidates, for `ambiguous`. |
| `candidateTopologySignatures` | string[] | yes | Candidate signatures. |
| `topologySignature` | string \| null | yes | Stable signature for a resolved reference. |
| `stepTopologySignature` | string \| null | yes | STEP-side signature. |

An `ambiguous` reference emits one edge per candidate, so a consumer can see all
possibilities; a `missing` reference emits an edge with `target: null` carrying
the reason. Unresolved associations are never dropped and never collapsed to a
first candidate.

### 3.4 `datum-reference` (DRF → Datum)

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `precedence` | number | yes | 1 = primary, 2 = secondary, 3 = tertiary. |
| `compartmentId` | string \| null | yes | STEP compartment the reference occupies. |
| `datumEntityId` | string | yes | Datum feature STEP id. |
| `datumIdentifier` | string | yes | Datum letter. |
| `modifiers` | string[] | yes | Material condition modifiers such as `M`. |
| `isCommonDatum` | boolean | yes | Common datum boundary indicator. |
| `controlledTopologyNodeIds` | string[] | yes | Topology the referenced datum controls, for transitive lookup. |

### 3.5 `component` (DRF → ordered datum list)

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `position` | number | yes | 1-based position in the datum list, ordered by precedence then identifier. |
| `precedence` | number | yes | The frame's own precedence for this reference. |
| `precedenceGroup` | number | yes | 1-based group index by distinct precedence. |
| `isSimultaneous` | boolean | yes | Another reference in this frame shares this precedence. |

**How a datum reference frame avoids becoming a tree.** The frame is a node with
parallel edges to datum nodes, and the order lives in the `component.position`
and `datum-reference.precedence` attributes. There is no nesting and no
parent-child chain between datums, so the same datum referenced by many frames
stays a single node. A consumer reconstructs the ordered list by sorting
`component` edges on `position`; a consumer that does not care about order reads
`datumOrder` on the frame node. `DatumReferenceFrame` nodes may themselves be
referenced by an FCF node through `datumReferenceFrameEntityId`, and that
reference is an attribute rather than a third edge kind to keep the edge set
small.

**Simultaneous datums are not a sequence.** A single precedence level can hold
several datums. `nist_stc_08` carries the frame `D | H-J` as `D@1, H@2, J@2`:
H and J form a combined secondary datum reference frame established
*together*, not one after the other. Six frames across the fixture set are of
this form, including `D | E-F-G`.

Reading `position` alone would therefore misreport those as ordered, which is a
manufacturing error rather than a cosmetic one: a consumer told "D, then H, then
J" would constrain the part differently from the drawing. `precedenceGroup` and
`isSimultaneous` make the distinction explicit, and the verification cross-checks
them against the STEP labels: every datum named after a hyphen in a frame label
must be flagged simultaneous.

### 3.6 `dimension-attachment` (FCF → Dimension)

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `relation` | enum | yes | `fcf-attached-to-dimension`. |
| `dimensionEntityId` | string | yes | The size callout the FCF annotates. |

Lets a consumer answer "which hole does this position tolerance control" without
re-deriving the association from shared targets.

The parser exposes no direct FCF-to-dimension link, so the attachment is
recovered from the controlled feature: an FCF and a size callout that name the
same STEP target annotate the same thing. The association is emitted only when it
is unambiguous, that is when exactly one size callout matches on exactly one
shared target. Where no size callout shares a target, or more than one does, no
edge is emitted and `attachedDimensionEntityId` stays `null`. A record that names
no target at all can never be attached, because every FCF with no target would
otherwise match every other. Grouping by target rather than by parse position
also keeps the result independent of parser ordering.

Across the fixture set this yields 32 attachments over 7 fixtures, each verified
to share at least one controlled target.

### 3.7 `datum-target-parent` (DatumTarget → Datum)

| Attribute | Type | Required | Rationale |
| --- | --- | --- | --- |
| `parentDatum` | string | yes | Datum letter the target belongs to. |

---

## 4. Ordering

Guaranteed by construction and asserted by the export driver:

| Element | Order |
| --- | --- |
| Face nodes | `runtimeId` numeric suffix |
| Edge nodes | `runtimeId` numeric suffix |
| Vertex nodes | `runtimeId` numeric suffix |
| PMI nodes | STEP `entityId` numeric value, then parser record id |
| Model DRFs | STEP `entityId`, then tolerance-scoped DRFs by owning tolerance |
| `adjacency` edges | source face id, then target face id, then shared edge id |
| `incidence` edges | emission order: face-boundary before edge-endpoint per edge |
| `pmi-topology` edges | owning PMI node, then target, then reference order |
| `datum-reference`, `component` edges | by frame node, then precedence, then datum identifier |
| Arrays inside nodes | STEP entity id, then code-unit order |

All string ordering compares UTF-16 code units. `localeCompare` is deliberately
avoided throughout: its result depends on the active locale, so the same input
could serialize differently on two machines and break the byte-identical
guarantee.

Node array order is fixed by kind: Face, Edge, Vertex, Datum, DatumTarget,
Dimension, GeometricTolerance, DatumReferenceFrame. Edge array order is fixed by
kind: adjacency, incidence, pmi-topology, datum-reference, component,
dimension-attachment, datum-target-parent.

## 5. Determinism

Same STEP file in, byte-identical JSON out, excluding `generatedAt`.

- Every float is rounded to 6 decimal places (`GRAPH_FLOAT_DIGITS`); `-0` is
  normalized to `0`.
- Ordering is fixed as in section 4. Set-valued attributes are sorted; object key
  order is insertion order, which is fixed by construction.
- No timestamp is embedded in a value. `generatedAt` is a top-level field
  present only when the caller supplies one, and `serializeGraphDeterministic`
  omits it. The Markdown summary omits it as well, so both committed artifacts
  are byte-identical across runs.
- The export driver builds each graph twice from independent parses and asserts
  the two serializations are byte-identical, then re-runs the whole fixture set
  and compares SHA-256 hashes of every file. Verified: all 34 artifacts
  (16 JSON graphs plus 16 Markdown summaries, plus the index files) match across
  runs.
- `serializeGraph` includes `generatedAt`; `serializeGraphDeterministic` omits
  it. Only the deterministic form is written to disk.

Geometry is captured at one fixed tessellation setting
(`linearDeflection 0.02`, `angularDeflection 0.1`), recorded in
`source`.

**Known sensitivity.** Topology identity, node set, edge set, PMI resolution and
every dihedral formed only from planes and fitted cylinders are stable across
tessellation settings; the verification reports a deviation of 0.000 degrees for
those junctions on the reference fixture. Two categories do move with mesh
density and are excluded from that claim, because the measurement itself is
resolution-limited rather than inconsistent:

- Tangent junctions, where a cylinder blends smoothly into a plane. The true
  dihedral is 180 degrees and the fine setting resolves it; a coarse deflection
  on a small radius does not sample enough of the blend.
- Junctions involving a cone, sphere or torus, and cylinders whose analytic fit
  was rejected as ill-conditioned. Their normals come from the tessellated patch.

## 6. `statistics`

Denormalized counters so a consumer can triage a file without a full scan:
`nodeCounts`, `edgeCounts`, `faceSurfaceTypeCounts`, `edgeCurveTypeCounts`,
`adjacencyConvexityCounts`, `pmiReferenceResolutionCounts`,
`nonManifoldEdgeCount`, `indeterminateConvexityCount`, `signedMeshVolume`,
`normalOrientation`.

`normalOrientation` is `outward`, `inward`, or `indeterminate`, derived from the
signed volume of the tessellation. It is a global consistency check: an `inward`
model means the mesh winding disagrees with the solid and every stored outward
normal has been flipped to compensate.

## 7. Versioning

`graphVersion` is an integer and is bumped for any change that a consumer could
observe: a removed or renamed attribute, a changed unit, a changed enum domain,
or a changed ordering rule. Adding an optional attribute with a `null` default is
a minor change and does not require a bump; a consumer written against version 1
keeps working.

Within a version, attributes are only ever added, never repurposed. Renaming
means: add the new name, keep the old one populated for one version, then remove
the old one in the next major bump.

## 8. Worked examples

### 8.1 Face

```json
{
  "id": "face:BRepFace-0",
  "kind": "Face",
  "label": "BRepFace-0 (cylinder)",
  "runtimeId": "BRepFace-0",
  "nativeIndex": 0,
  "stepEntityIds": ["#764"],
  "surfaceType": "cylinder",
  "area": 1963.495408,
  "centroid": [-85.484894, 28.74803, -25],
  "bounds": { "min": [-170.969788, 0, -50], "max": [0, 57.496059, 0] },
  "outwardNormal": [0, 0, 1],
  "normalSource": "cylinder-radial",
  "normalDeviationDeg": 0.402114,
  "cylinderAxis": [0, 0, 1],
  "cylinderRadius": 12.500001,
  "cylinderRadiusDeviation": 0.000007,
  "cylinderOrientation": "external",
  "windingConsistency": 1,
  "windingMinorityTriangles": 0,
  "edgeCount": 4,
  "loopCount": 1,
  "topologySignature": "occt:v1:face:fc15085058cb1be4",
  "meshVertexCount": 88,
  "meshTriangleCount": 86
}
```

### 8.2 Edge

```json
{
  "id": "edge:BRepEdge-41",
  "kind": "Edge",
  "label": "BRepEdge-41 (circle)",
  "runtimeId": "BRepEdge-41",
  "nativeIndex": 41,
  "curveType": "circle",
  "length": 62.831853,
  "closed": false,
  "stepEntityIds": [],
  "parentFaceIds": ["BRepFace-2", "BRepFace-63"],
  "vertexIds": ["BRepVertex-58", "BRepVertex-59"],
  "startPoint": [-240, 100, -50],
  "endPoint": [-240, 145, -50],
  "midpoint": [-240, 122.5, -50],
  "topologySignature": "occt:v1:edge:8d1c4f2a6b3e9075",
  "stepTopologySignature": null
}
```

### 8.3 Vertex

```json
{
  "id": "vertex:BRepVertex-58",
  "kind": "Vertex",
  "label": "BRepVertex-58",
  "runtimeId": "BRepVertex-58",
  "nativeIndex": 58,
  "point": [-240, 100, -50],
  "stepEntityIds": ["#1042"],
  "topologySignature": "occt:v1:vertex:41c9e7a3b8d25f60"
}
```

### 8.4 Datum

```json
{
  "id": "datum:#37",
  "kind": "Datum",
  "label": "Datum A",
  "entityId": "#37",
  "identifier": "A",
  "datumType": "Primary Flat Datum Plane",
  "symbol": "[ A ]",
  "targetName": "Datum A Planar Face (#861)",
  "targetStepEntityIds": ["#861"],
  "semanticTargetStepEntityIds": ["#861"],
  "derivedDatum": null,
  "targetSource": "semantic",
  "surfaceGeometry": [
    {
      "surfaceType": "plane",
      "targetId": "#861",
      "point": [-400, -225, 0],
      "normal": [0, 0, 1],
      "axis": null,
      "xDirection": [1, 0, 0]
    }
  ],
  "presentationTargetPoint": [-4.646957, 43.265406, 0],
  "unresolvedTargetStepEntityIds": [],
  "ambiguousTargetStepEntityIds": []
}
```

### 8.5 DatumTarget

```json
{
  "id": "datum-target:#71",
  "kind": "DatumTarget",
  "label": "Datum Target G1",
  "entityId": "#71",
  "identifier": "G1",
  "parentDatum": "G",
  "targetType": "circular curve",
  "targetName": "Datum target on B-Rep feature (#2119)",
  "targetStepEntityIds": ["#2119", "#2120"],
  "sizeLabels": [],
  "targetPoint": [76.2, 66.04, -158.75],
  "targetLine": null,
  "targetCircle": null,
  "targetCurvePointCount": 65,
  "targetZone": null,
  "unresolvedTargetStepEntityIds": ["#2119", "#2120"],
  "ambiguousTargetStepEntityIds": []
}
```

The unresolved list is the point of this example: an isolated `TRIMMED_CURVE`
target zone has no controlled model topology, and the graph says so instead of
dropping the target or attaching it to a nearby face.

### 8.6 Dimension

```json
{
  "id": "dimension:#182",
  "kind": "Dimension",
  "label": "Critical diameter target (#3218, #3229, #3219, #3230)",
  "entityId": "#182",
  "dimensionKind": "diameter",
  "targetName": "Critical diameter target (#3218, #3229, #3219, #3230)",
  "targetStepEntityIds": ["#3218", "#3219", "#3229", "#3230"],
  "nominalDimension": 0.8125,
  "lowerLimit": null,
  "upperLimit": null,
  "lowerTolerance": -0.02,
  "upperTolerance": 0.02,
  "preModifier": "2X",
  "decimalPlaces": null,
  "isReferenceDimension": false,
  "isBasicDimension": false,
  "isStatisticalTolerance": false,
  "isDatumTargetDimension": false,
  "isSphericalDimension": false,
  "isCircularCurveDimension": false,
  "isControlledRadiusDimension": false,
  "isThreadCall": false,
  "threadDesignation": null,
  "toleranceZoneShape": null,
  "modifiers": [],
  "secondary": null,
  "compound": {
    "kind": "counterbore",
    "holeNominal": 0.5625,
    "holeLowerTolerance": -0.008,
    "holeUpperTolerance": 0.008,
    "depthNominal": 0.5,
    "depthLowerTolerance": -0.02,
    "depthUpperTolerance": 0.02,
    "angleNominal": null,
    "angleLowerTolerance": null,
    "angleUpperTolerance": null,
    "slotRadiusNominal": null,
    "slotRadiusModel": null
  },
  "unresolvedTargetStepEntityIds": [],
  "ambiguousTargetStepEntityIds": []
}
```

### 8.7 GeometricTolerance

```json
{
  "id": "gdt:#21",
  "kind": "GeometricTolerance",
  "label": "Position 0.75",
  "entityId": "#21",
  "category": "Location",
  "targetStepEntityIds": ["#805"],
  "toleranceType": "Position",
  "symbol": "POS",
  "toleranceValue": 0.75,
  "toleranceZone": { "form": null, "isDiameter": false, "projectedHeight": null, "value": 0.75 },
  "modifiers": [],
  "isStatisticalTolerance": false,
  "hasToleranceModifiers": false,
  "targetName": "PMI target B-Rep Feature (#805)",
  "attachedDimensionEntityId": null,
  "datumReferenceFrameLabel": "A | B | C",
  "datumReferenceFrameEntityId": "#52",
  "datumReferenceOrder": ["A", "B", "C"],
  "unresolvedTargetStepEntityIds": [],
  "ambiguousTargetStepEntityIds": []
}
```

### 8.8 DatumReferenceFrame

```json
{
  "id": "drf:#52",
  "kind": "DatumReferenceFrame",
  "entityId": "#52",
  "scope": "model",
  "ownerEntityId": null,
  "name": "Datum System .2",
  "label": "A | B | C",
  "datumOrder": ["A", "B", "C"],
  "toleranceEntityIds": ["#21"],
  "frameBasis": {
    "origin": [-400, -225, 0],
    "xAxis": [1, 0, 0],
    "yAxis": [0, 1, 0],
    "zAxis": [0, 0, 1]
  },
  "unresolvedTargetStepEntityIds": [],
  "ambiguousTargetStepEntityIds": []
}
```

### 8.9 `adjacency`

```json
{
  "id": "adjacency:face:BRepFace-2|face:BRepFace-63|edge:BRepEdge-41",
  "kind": "adjacency",
  "source": "face:BRepFace-2",
  "target": "face:BRepFace-63",
  "sharedEdgeIds": ["BRepEdge-41"],
  "midpoint": [-240, 122.5, -50],
  "edgeTangent": [0, -1, 0],
  "normalSource": ["tessellation", "cylinder-radial"],
  "nonManifold": false,
  "normalAngleRad": 1.776192,
  "normalAngleDeg": 101.768289,
  "patchNormalAngleDeg": 45.086458,
  "convexity": "concave",
  "dihedralAngleRad": 4.917784,
  "dihedralAngleDeg": 281.768289,
  "convexityNote": null
}
```

A cylinder meeting a planar face: outward normals 101.77 degrees apart, and the
material occupies 281.77 degrees of the cross-section, so the junction is
re-entrant.

### 8.10 `incidence`

```json
{
  "id": "incidence:face:BRepFace-2|edge:BRepEdge-41",
  "kind": "incidence",
  "source": "face:BRepFace-2",
  "target": "edge:BRepEdge-41",
  "role": "face-boundary"
}
```

### 8.11 `pmi-topology`

Resolved:

```json
{
  "id": "pmi-topology:dimension:#9258|#82|BRepFace-1|0",
  "kind": "pmi-topology",
  "source": "dimension:#9258",
  "target": "face:BRepFace-1",
  "entityKind": "face",
  "targetStepEntityId": "#82",
  "resolution": "resolved",
  "resolutionReason": "unique-stable-signature",
  "runtimeId": "BRepFace-1",
  "candidateRuntimeIds": [],
  "candidateTopologySignatures": [],
  "topologySignature": "occt:v1:face:83e912c80f06cd4b",
  "stepTopologySignature": null
}
```

Missing, preserved rather than dropped:

```json
{
  "id": "pmi-topology:datum:#71|#2119|unresolved|0",
  "kind": "pmi-topology",
  "source": "datum:#71",
  "target": null,
  "entityKind": "face",
  "targetStepEntityId": "#2119",
  "resolution": "missing",
  "resolutionReason": "target-not-mapped",
  "runtimeId": null,
  "candidateRuntimeIds": [],
  "candidateTopologySignatures": [],
  "topologySignature": null,
  "stepTopologySignature": null
}
```

### 8.12 `datum-reference` and `component`

```json
{
  "id": "datum-reference:drf:#51|A",
  "kind": "datum-reference",
  "source": "drf:#51",
  "target": "datum:#37",
  "precedence": 1,
  "compartmentId": "#40",
  "datumEntityId": "#37",
  "datumIdentifier": "A",
  "modifiers": [],
  "isCommonDatum": false,
  "controlledTopologyNodeIds": ["face:BRepFace-97"]
}
```

```json
{
  "id": "component:drf:#52|0|A",
  "kind": "component",
  "source": "drf:#52",
  "target": "datum:#37",
  "position": 1,
  "precedence": 1,
  "precedenceGroup": 1,
  "isSimultaneous": false
}
```

A combined datum reference frame, `D | H-J`:

```json
{
  "id": "component:drf:#222|1|H",
  "kind": "component",
  "source": "drf:#222",
  "target": "datum:#242",
  "position": 2,
  "precedence": 2,
  "precedenceGroup": 2,
  "isSimultaneous": true
}
```

```json
{
  "id": "component:drf:#222|2|J",
  "kind": "component",
  "source": "drf:#222",
  "target": "datum:#241",
  "position": 3,
  "precedence": 2,
  "precedenceGroup": 2,
  "isSimultaneous": true
}
```

`position` orders the list, but `precedenceGroup` 2 shared across both edges is
what states that H and J are established simultaneously.

### 8.13 `dimension-attachment` and `datum-target-parent`

```json
{
  "id": "dimension-attachment:gdt:#39|dimension:#199",
  "kind": "dimension-attachment",
  "source": "gdt:#39",
  "target": "dimension:#199",
  "relation": "fcf-attached-to-dimension",
  "dimensionEntityId": "#199"
}
```

```json
{
  "id": "datum-target-parent:datum-target:#71|datum:#G",
  "kind": "datum-target-parent",
  "source": "datum-target:#71",
  "target": "datum:#G",
  "parentDatum": "G"
}
```

---

## 9. Findings outside the exporter

Two defects were found that cannot be fixed here, because the plan permits
changes only to `src/utils/exportGraph.ts`.

### 9.0 Unresolved `ADVANCED_FACE` targets are expected, not a gap

73 distinct unresolved target entities appear across the fixture set. 62 are
non-face entities for which `target-not-mapped` is the correct answer. The
remaining 11 are `ADVANCED_FACE`, and a consumer should not read those as
missing model topology either.

Every one is an open-shell face. The AP242 fixtures declare more `ADVANCED_FACE`
entities than OCCT tessellates, and the surplus is precisely the faces held in
`OPEN_SHELL` blocks. In `nist_ftc_10` the file declares 282 faces and the solid
renders 264; the 18-face difference is 12 `OPEN_SHELL` entities, which is more
than the surplus because some open-shell faces duplicate `CLOSED_SHELL` faces.

Those shells belong to `SHELL_BASED_SURFACE_MODEL` entities named `Extract`,
`Join`, `Split`, and `Fill`: the constructive-solid history that produced the
solid, not the solid. `applyClosedShellFaceOrderMapping` assigns face ordinals
from `CLOSED_SHELL` only, and the geometric fallback in `autoGenerateFaceMapping`
iterates over rendered faces, so a face that was never tessellated is never
considered. No geometry is lost. The `CLOSED_SHELL` holds the entire solid and
OCCT renders all of it.

The faces are presentation. In `nist_ctc_02`, `#3148` is a single `PLANE` face in
`OPEN_SHELL('Fill.1')` consumed by
`GEOMETRIC_ITEM_SPECIFIC_USAGE('', 'DATUM TARGET', ...)` and
`GEOMETRIC_ITEM_SPECIFIC_USAGE('', 'NOTE', ...)`, and it also appears inside a
`COMPLEX_TRIANGULATED_SURFACE_SET('note', ...)`. It is a datum target zone and a
leader note: drawing annotation with no place on the model.

A PMI record naming such a face is naming presentation geometry.
`resolution: "missing"` with `target: null` is the correct representation. Do not
extend the mapping to reach open-shell faces, and do not let a consumer assign
these to the nearest rendered face: the datum target is not on the solid, and a
tolerance attached to it would be a manufacturing error rather than a cosmetic
one. The same reasoning applies to the 62 non-face targets.

A related parsing defect was corrected on branch `fix/advanced-face-paren-scan`.
`autoGenerateFaceMapping` scanned faces with a non-greedy pattern that stopped at
the closing parenthesis of the `FACE_BOUND` list, discarding the surface argument
for all 3843 `ADVANCED_FACE` entities in the fixture set. A paren-depth scan now
captures each entity whole.

Correcting the scan exposed a second defect. The geometric matcher iterated
rendered meshes and considered annotation faces on equal terms with solid ones,
while never checking that the mesh it was assigning was still unclaimed, so an
annotation face could bind to a mesh the closed-shell ordinal route had already
given to a different solid face. This damage was already present in the exported
graphs: in `nist_ftc_10`, `BRepFace-220`, `-221`, `-222`, and `-225` each carried
one closed-shell face and two annotation faces.

Only `CLOSED_SHELL` faces now take part in geometric matching. All four
multi-identity face nodes are gone, and across the corpus no face node carries
more than one solid identity. `nist_ftc_10` moves from 473 resolved / 43 missing
to 465 / 51 because eight references naming annotation faces are now reported
unresolved. That is the correct direction: they were previously bound to real
geometry that they do not describe, and a tolerance attached to a datum target
symbol rather than the surface it marks is a manufacturing error.

The original exporter task was not permitted to modify files outside
`src/utils/exportGraph.ts`, which is why several findings in this section are
recorded rather than fixed. That restriction has since been lifted: changes
outside the exporter now go on their own branch, one concern per branch. The
findings below still stand as findings, and each remains open.

### 9.1 False PMI records in the AP203 control

`nist_ctc_01_asme1_ap203.stp` contains no `DATUM_FEATURE`, `DIMENSIONAL_SIZE`,
`GEOMETRIC_TOLERANCE`, `TOLERANCE_ZONE` or `DATUM_REFERENCE` entity, yet the
parser emits 3 datums and 14 dimensions for it. The parser matches STEP lines
with regular expressions and this file's `SHAPE_ASPECT` usage trips those
patterns. The control's purpose is served: it exposed the artifact and, with it,
the node-ID collision in section 2.0. Fixing it means editing `stepParser.ts`,
which is open work now that the exporter-only restriction has been lifted.

### 9.2 No direct FCF-to-dimension link

The parser exposes no direct link from an FCF to the size callout it annotates,
which is why section 3.6 recovers the attachment from the shared controlled
feature. Once the parser does carry that link, the explicit reference already
takes precedence over the derived one and no exporter change is needed.

### 9.3 Phantom geometric tolerances on relationship wrappers

Across the corpus, 36 `GeometricTolerance` nodes have no `pmi-topology` edge and
an empty `targetStepEntityIds`. All 36 are records emitted for a
`GEOMETRIC_TOLERANCE_RELATIONSHIP` composite wrapper rather than for the
`GEOMETRIC_TOLERANCE` it contains. A wrapper of the form

    #61=GEOMETRIC_TOLERANCE_RELATIONSHIP('composite','',#93,#94);
    #93=( GEOMETRIC_TOLERANCE('Feature Control Frame (28)',...,#571,#393) ... );

names two child tolerances and no shape aspect of its own, so it has nothing for
the resolver to match. Every one of these records carries
`toleranceType: "Geometric Tolerance"`, where a genuine record carries `Position`,
`Parallelism`, `Surface Profile`, and so on, and the tolerance it duplicates is
usually already present in the graph as a properly resolved node. In
`nist_ftc_08` the record for `#61` is a phantom alongside the resolved Position
tolerance for `#93`.

These are parser artifacts, not missing PMI, and a consumer counting geometric
tolerances will over-count by 36 across the corpus. The same class of defect as
section 9.1, and the same fix location: the tolerance parser in `stepParser.ts`
should not emit a record for a relationship wrapper. Note that correcting it
changes the emitted record set, so every fixture's node counts and determinism
baseline shift and must be re-exported.

## 10. Negative control

`nist_ctc_01_asme1_ap203.stp` is included as a geometry-only control. The file
contains no `DATUM_FEATURE`, `DIMENSIONAL_SIZE`, `GEOMETRIC_TOLERANCE`,
`TOLERANCE_ZONE` or `DATUM_REFERENCE` entity at all, yet the semantic parser
emits 3 datums and 14 dimensions for it.

Those records are parser artifacts, not geometry: the parser matches STEP lines
with regular expressions and this file's `SHAPE_ASPECT` usage trips those
patterns. The graph faithfully represents what the parser returned, and the
control's real value is that it made the artifact visible and surfaced the
node-ID collision in section 2.0.

Resolving the false positives means changing `stepParser.ts`. An AP203 file
should yield zero PMI records, and the regexes in `stepParser.ts` are matching
annotation occurrences that carry no tolerance semantics.

## 11. Design decisions

### 11.1 Node-per-face in the base graph

Faces are the base node type; features are derived. A hole, a counterbore or a
pocket is a *grouping* of exact B-Rep faces, and the roadmap's feature-recognition
task has to consume those groups later. Putting features in the base graph would
force every exporter to invent the same grouping, and any disagreement with the
recognizer would have to be resolved in the file format rather than in one layer.
Exporting faces keeps the recognition layer free to change its grouping without
invalidating the graph.

### 11.2 Zones versus values

Values and zones are separated rather than merged, for the reason in section
2.7: a value is a scalar the file states, while a zone is a region that depends
on surface type, modifiers and dimensional context. Flattening them would force
a consumer to reconstruct zone geometry from a number and to guess when the file
did not state the zone at all.

### 11.3 Datum reference frames are not trees

Ordering is carried by `component.position` on parallel edges, so the same datum
node can participate in many frames. Simultaneity within a precedence level is
carried by `precedenceGroup` and `isSimultaneous`, because a combined frame such
as `H-J` is not an ordered pair. see sections 3.5 and 10.

### 11.4 Cylindrical faces

The axis direction follows the viewer. `computeFaceInteractionCache` in
`CadCanvas3D.tsx` derives `interactionCache.cylinderAxis` by taking the mean
absolute normal and selecting the coordinate axis whose component is smallest; on
a true cylinder every normal is perpendicular to the axis, so that component
vanishes and identifies it. That rule is authoritative here and overrides an
eigen-decomposition of the normal outer product, which was the earlier choice.

The rule is a heuristic, not a fit: it snaps to a coordinate axis, so a bore at an
arbitrary angle is assigned the nearest one rather than its true direction. Two
consequences are handled rather than papered over.

**The axis is checked against the patch before it is published.** The same mean
absolute normal that selected the axis is read back as the mean absolute dot
product of the patch's triangle normals with the chosen axis. It is zero when the
normals really are perpendicular to that axis and grows with the angular error,
so `MAX_AXIS_PERPENDICULARITY` gates the axis. Across the fixture set this
withholds 73 cylinder faces whose true axes lie about 45 degrees off a coordinate
axis: rather than publishing a snapped axis, `cylinderRadius` is reported `null`
and `normalSource` stays `tessellation`. A partial arc of such a bore is not
reliably caught and is a known limit of the heuristic.

**The cross-section centre is still fitted, not assumed.** The fitted circle
centre plus the mean axial station gives a concrete point on the axis line. The
axis must pass through the centre of its own cross-section, not through the model
origin, or every radial derived from it is measured from the wrong place.

**Outward sense comes from a majority vote of triangle normals**, each locally
outward on a consistently wound patch. A patch subtending more than a hemisphere
has a mean normal pointing away from the radial, so orienting the radial against
the mean inverts large-arc bores.

Degenerate fits are rejected rather than trusted: the patch must wind
consistently (`MIN_WINDING_CONSISTENCY`) and the fitted radius must be plausible
against the patch extent. Rejection is visible in the output as
`normalSource: "tessellation"` with `cylinderRadius: null`.

Because a coordinate axis is exactly determined, the eigen-degeneracy failure
that previously suppressed coarse patches no longer applies: the number of
cylinder faces publishing a radius rose from 1572 to 1591, and the count of
junctions whose dihedral is stable to within 0.002 degrees across a tenfold
change in `linearDeflection` rose from 190 of 318 to 210 of 318.

### 11.5 Minimum viable graph

The graph carries exactly what a manufacturing question needs and no more:

- Topology that is already computed anyway: faces, edges, vertices, adjacency,
  incidence. The face-adjacency graph is present because a manufacturing feature
  is precisely a set of faces.
- Dihedral and convexity per junction, since "is this a hole, a boss or a
  fillet" is a question about edges between faces.
- Surface and curve classification, since they decide how a feature is machined.
- PMI semantics and their topology edges, since the tolerances are the
  requirement.
- Explicit uncertainty attributes.

Deliberately omitted: tessellation vertex and triangle coordinates, per-vertex
normals, face loop membership, PMI annotation geometry for rendering, and
presentation-only placement. These are rendering concerns and would dominate the
context window of any consumer. `targetCurvePointCount` shows the deliberate
trade: curve-target geometry is summarized rather than serialized.

Measured sizes at this tessellation setting: `nist_ctc_01_asme1_ap242-e1` is
810 kB for 665 nodes and 1678 edges, and `nist_ctc_02_asme1_ap242-e2` is 4.5 MB
for 2997 nodes and 7514 edges.

A whole-part graph is therefore too large for a single prompt, and that is the
honest answer to the context-window question: the exporter provides the
substrate, and a consumer selects a subgraph. The natural selection is a
feature neighbourhood, reachable in three hops from any seed node: the PMI node
for a callout, its `pmi-topology` edges to the faces it controls, and those
faces' `adjacency` edges to their neighbours. On `nist_ctc_01` that is on the
order of tens of nodes rather than hundreds, which is a usable prompt payload.

Two further reductions are available without changing the schema and are noted
here rather than applied, because the plan asks for the full geometric minimum:
`adjacency` edges can be dropped when only PMI-to-topology traversal is needed,
and vertex nodes and `edge-endpoint` incidence can be dropped when edge
interaction is not queried.
