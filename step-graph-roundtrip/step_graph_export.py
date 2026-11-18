# -*- coding: utf-8 -*-
"""
Standalone STEP graph exporter.

Reads an ISO-10303-21 (STEP) file and writes:

  * ``<part>.graph.json`` — topology, analytic/parametric geometry, PMI and a
    face-adjacency section (schema ``graphVersion: 2``);
  * ``<part>.face-adjacency-matrix.csv`` — 0/1 shared-edge matrix;
  * ``<part>.face-adjacency-weighted.csv`` — same matrix weighted by the
    dihedral angle between the two faces.

Only the Python standard library is used; no CAD kernel is involved.

Topology walk (mirrors the TypeScript viewer):
  CLOSED_SHELL/OPEN_SHELL -> ADVANCED_FACE/FACE_SURFACE
    -> FACE_BOUND/FACE_OUTER_BOUND -> EDGE_LOOP -> ORIENTED_EDGE -> EDGE_CURVE

PMI resolution chain (native STEP semantics):
  GEOMETRIC_TOLERANCE / DIMENSIONAL_SIZE
    -> shape_aspect (often COMPOSITE_/ALL_AROUND_)
    -> SHAPE_ASPECT_RELATIONSHIP -> component SHAPE_ASPECT
    -> GEOMETRIC_ITEM_SPECIFIC_USAGE -> ADVANCED_FACE / EDGE_CURVE
  Datums: GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE -> DATUM_SYSTEM/DATUM_REFERENCE -> DATUM
  Dimension values: DIMENSIONAL_CHARACTERISTIC_REPRESENTATION -> SHAPE_DIMENSION_REPRESENTATION

CLI:
    python step_graph_export.py part.stp [-o OUT_DIR]
"""
import re
import json
import math
import os
from collections import defaultdict, OrderedDict

FLOAT_RE = re.compile(r'[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[Ee][-+]?\d+)?')
TOL_FLAT = 0.01  # rad (~0.57 deg)

TOL_TYPE_NAMES = {
    'FLATNESS_TOLERANCE': 'flatness', 'STRAIGHTNESS_TOLERANCE': 'straightness',
    'CIRCULARITY_TOLERANCE': 'circularity', 'ROUNDNESS_TOLERANCE': 'roundness',
    'CYLINDRICITY_TOLERANCE': 'cylindricity', 'POSITION_TOLERANCE': 'position',
    'PARALLELISM_TOLERANCE': 'parallelism', 'PERPENDICULARITY_TOLERANCE': 'perpendicularity',
    'ANGULARITY_TOLERANCE': 'angularity', 'CONCENTRICITY_TOLERANCE': 'concentricity',
    'SYMMETRY_TOLERANCE': 'symmetry', 'CIRCULAR_RUNOUT_TOLERANCE': 'circular runout',
    'TOTAL_RUNOUT_TOLERANCE': 'total runout', 'PROFILE_OF_LINE_TOLERANCE': 'profile of line',
    'PROFILE_OF_SURFACE_TOLERANCE': 'profile of surface', 'LINE_PROFILE_TOLERANCE': 'profile of line',
    'SURFACE_PROFILE_TOLERANCE': 'profile of surface',
}

SURFACE_TYPES = {
    'PLANE', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SPHERICAL_SURFACE',
    'TOROIDAL_SURFACE', 'DEGENERATE_TOROIDAL_SURFACE', 'SURFACE_OF_REVOLUTION',
    'SURFACE_OF_LINEAR_EXTRUSION', 'B_SPLINE_SURFACE_WITH_KNOTS', 'B_SPLINE_SURFACE',
    'RATIONAL_B_SPLINE_SURFACE', 'RECTANGULAR_TRIMMED_SURFACE', 'CURVE_BOUNDED_SURFACE',
    # leading component of a complex freeform surface, e.g.
    #   ( BOUNDED_SURFACE() B_SPLINE_SURFACE(...) B_SPLINE_SURFACE_WITH_KNOTS(...) )
    'BOUNDED_SURFACE', 'ELEMENTARY_SURFACE', 'SWEPT_SURFACE', 'OFFSET_SURFACE',
    'CURVE_BOUNDED_SURFACE', 'TRIMMED_SURFACE',
}


def is_aspect_type(t):
    return 'SHAPE_ASPECT' in t or t in ('DATUM_FEATURE', 'DATUM_TARGET')

# ---------------------------------------------------------------- tessellation

# Faces in a tessellated representation. A TESSELLATED_SOLID is a shell of
# TRIANGULATED_FACE / COMPLEX_TRIANGULATED_FACE items, each carrying its own
# COORDINATES_LIST (a flat pool of vertices) plus a triangle index list. This is
# a *different* B-Rep representation from the classic ADVANCED_FACE/EDGE_LOOP
# graph and must be read explicitly -- otherwise a perfectly valid solid exports
# as an empty graph (the callers then compare two empty graphs and wrongly
# report a faithful round trip).
TESSELLATED_FACE_TYPES = ('TRIANGULATED_FACE', 'COMPLEX_TRIANGULATED_FACE')
TESSELLATED_GEOM_TYPES = (
    'TESSELLATED_SOLID', 'TESSELLATED_SHELL', 'TESSELLATED_FACE',
    'TRIANGULATED_FACE', 'COMPLEX_TRIANGULATED_FACE', 'COORDINATES_LIST',
)


def _coordinate_points(entity):
    """Return the 3-tuple vertices of a COORDINATES_LIST (or its equivalent).

    A COORDINATES_LIST statement is ``COORDINATES_LIST(name,n,( (x,y,z), ... ))``;
    some writers use a plain ``CARTESIAN_POINT``-list. The nested list of
    coordinate triples is parsed positionally and never guessed.
    """
    m = re.search(r'\(\s*\(([^()]*)\)(?:\s*,)?', entity['stmt'])
    pts = []
    for mm in re.finditer(r'\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)',
                          entity['stmt']):
        try:
            pts.append([float(mm.group(1)), float(mm.group(2)), float(mm.group(3))])
        except ValueError:
            continue
    return pts


def _tess_number(tok):
    """Parse one STEP number, keeping integers as ints and reals as floats."""
    tok = tok.strip()
    try:
        if '.' in tok or 'e' in tok.lower():
            return float(tok)
        return int(tok)
    except ValueError:
        return 0


def _tess_num_list(text):
    """Parse a flat STEP aggregate ``(a,b,c)`` into ``[a,b,c]``."""
    if not text:
        return []
    text = text.strip()
    if not text.startswith('(') or not text.endswith(')'):
        return []
    inner = text[1:-1].strip()
    if not inner:
        return []
    return [_tess_number(x) for x in inner.split(',') if x.strip()]


def _tess_num_lists(text):
    """Parse a nested STEP aggregate ``((a,b),(c,d))`` into ``[[a,b],[c,d]]``."""
    if not text:
        return []
    text = text.strip()
    if not text.startswith('(') or not text.endswith(')'):
        return []
    inner = text[1:-1].strip()
    if not inner:
        return []
    return [_tess_num_list(m.group(0)) for m in re.finditer(r'\([^()]*\)', inner)]


def _strip_triangles(strip):
    """Expand a triangle strip (v0,v1,v2,v3,...) into triangles."""
    out = []
    for k in range(len(strip) - 2):
        if k % 2 == 0:
            out.append([strip[k], strip[k + 1], strip[k + 2]])
        else:
            out.append([strip[k + 1], strip[k], strip[k + 2]])
    return out


def _fan_triangles(fan):
    """Expand a triangle fan (v0,v1,v2,...) into triangles."""
    if len(fan) < 3:
        return []
    return [[fan[0], fan[k], fan[k + 1]] for k in range(1, len(fan) - 1)]


def parse_tessellated(entities, order):
    """Read a tessellated representation into a topology-only record.

    Returns a dict with:
      * ``solids``  -- [{id, name, items:[face/shell ids], faces:[face ids]}]
      * ``shells``  -- [{id, name, items:[face ids], faces:[face ids]}]
      * ``faces``   -- [{id, kind, surfaceRef, surfaceType, coordinatesId,
                         pnmax, normals, pnindex, triangleStrips, triangleFans,
                         triangles}]
    or ``None`` when the file carries no tessellated geometry. Never invents
    geometry: a face with no coordinate pool is reported with an empty list.
    """
    tshell_ids = [eid for eid in order if entities[eid]['type'] == 'TESSELLATED_SHELL']
    tess_ref_types = TESSELLATED_FACE_TYPES + ('TESSELLATED_SHELL',)
    tsolid = []
    for eid in order:
        e = entities[eid]
        if e['type'] == 'TESSELLATED_SOLID':
            args = entity_args(e) or []
            items = [r for r in e['refs'] if entities.get(r, {}).get('type') in tess_ref_types]
            faces = [r for r in items
                     if entities[r]['type'] in TESSELLATED_FACE_TYPES]
            tsolid.append({'id': eid,
                           'name': args[0].strip("'") if args else '',
                           'items': items, 'faces': faces})
    # shells
    shells = []
    for eid in tshell_ids:
        e = entities[eid]
        args = entity_args(e) or []
        items = [r for r in e['refs'] if entities.get(r, {}).get('type') in TESSELLATED_FACE_TYPES]
        shells.append({'id': eid, 'name': args[0].strip("'") if args else '',
                       'items': items, 'faces': items})

    # Faces belong to the file's tessellated solid/shell structure as declared;
    # no synthetic shell is invented for faces a solid references directly.
    face_ids_t = []
    seen = set()
    for src_list in ([sh['faces'] for sh in shells] + [s['faces'] for s in tsolid]):
        for f in src_list:
            if f not in seen:
                seen.add(f)
                face_ids_t.append(f)
    if not face_ids_t:
        # last-resort: any triangulated face in the file
        face_ids_t = [eid for eid in order if entities[eid]['type'] in TESSELLATED_FACE_TYPES]
    if not face_ids_t:
        return None

    tfaces = []
    for fid in face_ids_t:
        e = entities[fid]
        args = entity_args(e) or []
        kind = e['type']
        # Attribute order (ISO 10303-42 tessellated_geometry_schema):
        #   geometric_representation_item.name
        #   tessellated_face.coordinates, .pnmax, .normals, .geometric_link
        #   triangulated_face.pnindex, .triangles
        #   complex_triangulated_face.pnindex, .triangle_strips, .triangle_fans
        # The geometric_link is the optional supporting surface; the coordinates
        # reference is the COORDINATES_LIST.
        coord_ref = None
        surf_ref = None
        for r in e['refs']:
            t = entities.get(r, {}).get('type')
            if t == 'COORDINATES_LIST' and coord_ref is None:
                coord_ref = r
            elif t in SURFACE_TYPES and surf_ref is None:
                surf_ref = r
        arg = lambda i: args[i] if i < len(args) else None
        pnmax = arg(2)
        try:
            pnmax = int(str(pnmax))
        except (TypeError, ValueError):
            pnmax = None
        normals = _tess_num_lists(arg(3))
        pnindex = _tess_num_list(arg(5))
        strips, fans = [], []
        if kind == 'COMPLEX_TRIANGULATED_FACE':
            strips = _tess_num_lists(arg(6))
            fans = _tess_num_lists(arg(7))
            tris = []
            for strip in strips:
                tris.extend(_strip_triangles(strip))
            for fan in fans:
                tris.extend(_fan_triangles(fan))
        else:
            tris = [row for row in _tess_num_lists(arg(6)) if len(row) >= 3]
            strips = [list(row) for row in tris]
        tfaces.append({
            'id': fid,
            'kind': kind,
            'surfaceRef': surf_ref,
            'surfaceType': entities[surf_ref]['type'] if surf_ref else None,
            'coordinatesId': coord_ref,
            # the *used* coordinates are resolved at graph-assembly time from a
            # deduplicated pool, so a shared pool is never copied per face.
            'coordinates': [],
            'pnmax': pnmax,
            'normals': normals,
            'pnindex': pnindex,
            'triangleStrips': strips,
            'triangleFans': fans,
            'triangles': tris,
        })
    return {'solids': tsolid, 'shells': shells, 'faces': tfaces,
            'pools': _coordinate_pools(entities, tfaces)}


def _coordinate_pools(entities, tfaces):
    """Build a deduplicated {poolId: [points]} map for the tessellated faces.

    A COORDINATES_LIST is a shared vertex pool; many triangulated faces point at
    the same pool and index into it. Storing the pool once (keyed by its STEP id)
    keeps the graph proportional to the source file instead of expanding every
    face's full pool.
    """
    pools = {}
    for tf in tfaces:
        cid = tf.get('coordinatesId')
        if not cid or cid in pools:
            continue
        pts = _coordinate_points(entities[cid])
        if pts:
            pools[cid] = pts
    return pools


def _triangle_key(p0, p1, p2):
    def norm(p):
        return tuple(round(float(c), 9) for c in p)
    return tuple(sorted((norm(p0), norm(p1), norm(p2))))


def _poly_triangle(entities, face_id):
    """Corner points of a FACE_SURFACE bounded by a single three-point POLY_LOOP.

    Returns None when the face is not that shape (i.e. an ordinary B-rep face).
    """
    for bound in entities[face_id]['refs']:
        be = entities.get(bound)
        if not be or be['type'] not in ('FACE_BOUND', 'FACE_OUTER_BOUND'):
            continue
        for loop in be['refs']:
            le = entities.get(loop)
            if not le or le['type'] != 'POLY_LOOP':
                return None
            pts = [get_point(entities, r) for r in le['refs']
                   if entities.get(r, {}).get('type') == 'CARTESIAN_POINT']
            if len(pts) != 3 or any(p is None for p in pts):
                return None
            return _triangle_key(*pts)
    return None


def _face_bound_points(entities, face_id):
    """Point list of every bound of a FACE_SURFACE.

    Handles both encodings the rebuilder uses: ``POLY_LOOP`` (per-triangle
    fallbacks) and ``EDGE_LOOP`` of ``ORIENTED_EDGE``/``EDGE_CURVE``/``VERTEX_POINT``
    (faces on the exact supporting surface). Returns None when a bound is
    something else or a loop is unusable.
    """
    loops = []
    for bound in entities[face_id]['refs']:
        be = entities.get(bound)
        if not be or be['type'] not in ('FACE_BOUND', 'FACE_OUTER_BOUND'):
            continue
        found = False
        for loop in be['refs']:
            le = entities.get(loop)
            if not le:
                return None
            if le['type'] == 'POLY_LOOP':
                pts = [get_point(entities, r) for r in le['refs']
                       if entities.get(r, {}).get('type') == 'CARTESIAN_POINT']
                if len(pts) < 3 or any(p is None for p in pts):
                    return None
            elif le['type'] == 'EDGE_LOOP':
                pts = []
                for oe in le['refs']:
                    oriented = entities.get(oe)
                    if not oriented or oriented['type'] != 'ORIENTED_EDGE':
                        return None
                    edge = None
                    for r in oriented['refs']:
                        if entities.get(r, {}).get('type') == 'EDGE_CURVE':
                            edge = entities[r]
                            break
                    if not edge:
                        return None
                    for r in edge['refs']:
                        if entities.get(r, {}).get('type') == 'VERTEX_POINT':
                            vp = entities[r]
                            for pr in vp['refs']:
                                if entities.get(pr, {}).get('type') == 'CARTESIAN_POINT':
                                    pts.append(get_point(entities, pr))
                                    break
                            break
                if len(pts) < 3 or any(p is None for p in pts):
                    return None
            else:
                return None
            loops.append(pts)
            found = True
        if not found:
            return None
    return loops or None


def _mesh_point(p):
    return tuple(round(float(c), 6) for c in p)


def derived_faceted_faces(entities, order, tess):
    """Face ids of a B-rep that only restates a tessellated solid.

    AP242 allows one surface to be written twice: as a TESSELLATED_SOLID and as
    a B-rep. Both describe the same geometry, so counting both would double
    every face. The B-rep is treated as an alternative representation -- and its
    faces excluded from the model's topology -- when it is provably derived from
    the tessellation:

    * every face of the B-rep is bounded only by loops this rebuilder writes
      (``POLY_LOOP`` or ``EDGE_LOOP``), and
    * either each such face is exactly one tessellation triangle, or
    * its face count is between the number of tessellated solid faces and their
      triangle count, and every boundary point is a tessellation vertex.

    Any other file keeps its B-rep faces.
    """
    if not tess:
        return set()
    source = set()
    mesh = set()
    tri_count = {}
    for f in tess['faces']:
        pts = tess['pools'].get(f.get('coordinatesId')) or []
        pn = f.get('pnindex') or list(range(1, len(pts) + 1))
        count = 0
        for tri in f.get('triangles') or []:
            try:
                corners = [pts[int(pn[int(i) - 1]) - 1] for i in tri]
            except (IndexError, TypeError, ValueError):
                continue
            count += 1
            for p in corners:
                mesh.add(_mesh_point(p))
            try:
                source.add(_triangle_key(*corners))
            except (IndexError, TypeError, ValueError):
                continue
        tri_count[f.get('id')] = count
    if not source:
        return set()

    # The B-rep restates the *solid*, so compare against the faces the
    # tessellated solids declare (a standalone shell, e.g. a measurement
    # contract surface, is supplemental and has no B-rep counterpart).
    declared = []
    for so in (tess.get('solids') or []):
        declared.extend(so.get('faces') or [])
        for it in (so.get('items') or []):
            for sh in (tess.get('shells') or []):
                if sh.get('id') == it:
                    declared.extend(sh.get('faces') or sh.get('items') or [])
    if not declared:
        declared = list(tri_count)
    declared = list(dict.fromkeys(d for d in declared if d in tri_count))
    if not declared:
        return set()
    min_faces = len(declared)
    max_faces = sum(tri_count[d] for d in declared)

    faces = [eid for eid in order if entities[eid]['type'] == 'FACE_SURFACE']
    if not faces or not (min_faces <= len(faces) <= max_faces):
        return set()
    loops = [_face_bound_points(entities, eid) for eid in faces]
    if any(bounds is None for bounds in loops):
        return set()

    # (a) one PLANE per source triangle (the fully faceted fallback)
    if all(len(bounds) == 1 and len(bounds[0]) == 3 for bounds in loops):
        if all(_triangle_key(*bounds[0]) in source for bounds in loops):
            return set(faces)
        return set()

    # (b) one face per tessellated face, on the face's own surface -- or a mix
    # of those and per-triangle fallbacks
    for bounds in loops:
        for loop in bounds:
            for p in loop:
                if _mesh_point(p) not in mesh:
                    return set()
    return set(faces)

# ---------------------------------------------------------------- parsing

def parse_step(text):
    entities, order = {}, []
    for m in re.finditer(r'(#\d+)\s*=\s*([\s\S]*?);', text):
        eid = m.group(1)
        stmt = re.sub(r'\s+', ' ', m.group(2)).strip()
        # A complex instance may lead with '(' and optional spaces before the
        # first component name, e.g. "( BOUNDED_SURFACE() B_SPLINE_SURFACE(...))".
        # Skip both so the entity is typed by its first component.
        tm = re.match(r"\(?\s*([A-Z][A-Z0-9_]*)\s*\(", stmt)
        entities[eid] = {'id': eid, 'type': tm.group(1).upper() if tm else '',
                         'stmt': stmt, 'refs': re.findall(r'#\d+', stmt)}
        order.append(eid)
    return entities, order


def split_args(s):
    args, depth, cur, in_str = [], 0, '', False
    for ch in s:
        if in_str:
            cur += ch
            if ch == "'":
                in_str = False
            continue
        if ch == "'":
            in_str = True; cur += ch; continue
        if ch == '(':
            depth += 1; cur += ch; continue
        if ch == ')':
            depth -= 1; cur += ch; continue
        if ch == ',' and depth == 0:
            args.append(cur.strip()); cur = ''
            continue
        cur += ch
    if cur.strip():
        args.append(cur.strip())
    return args


def entity_args(e):
    m = re.match(r"([A-Z][A-Z0-9_]*)\s*\((.*)\)\s*$", e['stmt'], re.S)
    return split_args(m.group(2)) if m else None


def complex_components(e):
    s, comps, i = e['stmt'], [], 0
    for m in re.finditer(r"([A-Z][A-Z0-9_]*)\s*\(", s):
        if m.start() < i:
            continue
        name = m.group(1)
        j, depth, in_str, buf = m.end(), 1, False, ''
        while j < len(s) and depth > 0:
            ch = s[j]
            if in_str:
                buf += ch
                if ch == "'":
                    in_str = False
            elif ch == "'":
                in_str = True; buf += ch
            elif ch == '(':
                depth += 1; buf += ch
            elif ch == ')':
                depth -= 1
                if depth > 0:
                    buf += ch
            else:
                buf += ch
            j += 1
        comps.append((name, split_args(buf)))
        i = j
    return comps


def is_complex_instance(e):
    """True when a STEP instance is a *complex* entity (multiple components).

    A complex instance is written either as a single parenthesised statement
    beginning with '(' -- e.g.
        #95=(GEOMETRIC_TOLERANCE(...)GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE(...)
             POSITION_TOLERANCE());
    or as the equivalent multi-line form where the leading '(' and separating
    '(' ')' are omitted:
        #95=GEOMETRIC_TOLERANCE(...)
             GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE(...)
             POSITION_TOLERANCE();
    Both are valid ISO-10303-21. Detecting only the first form (as the original
    exporter did) silently dropped every tolerance in files round-tripped
    through this toolchain, so recognise both here.
    """
    s = e['stmt']
    if s.lstrip().startswith('('):
        return True
    return len(complex_components(e)) > 1

# ---------------------------------------------------------------- vector math

def sub(a, b): return [a[i] - b[i] for i in range(3)]
def dot(a, b): return sum(a[i] * b[i] for i in range(3))
def cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def norm(a): return math.sqrt(dot(a, a))

def normalize(a):
    n = norm(a)
    return [v / n for v in a] if n > 1e-12 else None

def project_on_axis(p, origin, axis):
    d = sub(p, origin)
    t = dot(d, axis)
    return [origin[i] + t * axis[i] for i in range(3)]

# ---------------------------------------------------------------- geometry helpers

def get_point(entities, ref):
    e = entities.get(ref)
    if not e:
        return None
    m = re.search(r"\(\s*'[^']*'\s*,\s*\(([^)]*)\)", e['stmt'])
    if not m:
        return None
    try:
        vals = [float(v) for v in m.group(1).split(',')]
    except ValueError:
        return None
    return vals if len(vals) == 3 else None


def logical_flag(arg):
    """Parse a STEP ``LOGICAL`` value, preserving the tri-state.

    ISO-10303-21 ``LOGICAL`` is ``.T.`` / ``.F.`` / ``.U.`` (true / false /
    unknown). The unknown state is *not* the same as false: it means the
    writer made no assertion, so a reader (e.g. OCCT) is free to decide from
    the geometry. Collapsing ``.U.`` to ``.F.`` changes the meaning of a
    B-spline's ``closed`` / ``self_intersect`` flag and can make a reader
    reject or mis-sew the face. We therefore keep the exact token.
    """
    if arg is None:
        return 'U'
    t = arg.strip().upper()
    if t in ('.T.', 'T'):
        return 'T'
    if t in ('.F.', 'F'):
        return 'F'
    return 'U'


def get_direction(entities, ref):
    e = entities.get(ref)
    if not e:
        return None
    m = re.search(r"DIRECTION\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)", e['stmt'])
    if not m:
        return None
    try:
        vals = [float(v) for v in m.group(1).split(',')]
    except ValueError:
        return None
    return normalize(vals) if len(vals) == 3 else None


def get_placement(entities, ref):
    e = entities.get(ref)
    if not e or 'AXIS2_PLACEMENT_3D' not in e['stmt']:
        return None
    args = entity_args(e)
    if not args or len(args) < 2:
        return None
    origin = get_point(entities, args[1]) if args[1].startswith('#') else None
    if origin is None:
        return None
    axis = get_direction(entities, args[2]) if len(args) > 2 and args[2].startswith('#') else None
    xdir = get_direction(entities, args[3]) if len(args) > 3 and args[3].startswith('#') else None
    return (origin, axis or [0.0, 0.0, 1.0], xdir or [1.0, 0.0, 0.0])


def _grid_of_refs(arg):
    """Parse a nested control-point grid argument into a list of rows of refs.

        ((#a,#b,#c),(#d,#e,#f),...)  ->  [['#a','#b','#c'], ['#d','#e','#f'], ...]
    """
    rows = re.findall(r'\(([^()]*)\)', arg)
    grid = []
    for row in rows:
        ids = re.findall(r'#\d+', row)
        if ids:
            grid.append(ids)
    return grid


def _numlist(arg):
    return [float(x) for x in re.findall(r'[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?', arg)]


def _ints(arg):
    return [int(float(x)) for x in re.findall(r'\d+', arg)]


def curve_type_of(entities, ref):
    """Canonical geometric curve type for an EDGE_CURVE geometry entity.

    Complex instances are typed by their first component, which may be a wrapper
    such as BOUNDED_CURVE; report the underlying geometric curve instead so a
    round trip through this toolchain is type-stable.
    """
    e = entities.get(ref)
    if not e:
        return None
    if is_complex_instance(e):
        names = [n for n, _ in complex_components(e)]
        for cand in ('B_SPLINE_CURVE_WITH_KNOTS', 'B_SPLINE_CURVE',
                     'LINE', 'CIRCLE', 'ELLIPSE'):
            if cand in names:
                return 'B_SPLINE_CURVE_WITH_KNOTS' if 'B_SPLINE' in cand else cand
    return e['type']


def get_surface(entities, ref, angle_scale=1.0):
    """Extract a rebuildable description of a face's supporting surface.

    Analytic surfaces carry their placement + parameters. Freeform / swept
    surfaces (B-spline surfaces, surfaces of revolution / linear extrusion,
    trimmed and curve-bounded surfaces) are captured with their full defining
    data -- control-point grid, knots, and basis references -- so the graph can
    represent them exactly instead of collapsing them to a bare type.

    ``angle_scale`` converts the file's plane-angle unit to radians; the graph
    always stores radians so the rebuilder can emit a radian-based file.
    """
    e = entities.get(ref)
    if not e:
        return None

    def refs_grid(arg):
        return _grid_of_refs(arg)

    def points_grid(arg):
        return [[get_point(entities, r) for r in row] for row in _grid_of_refs(arg)]

    def placement_of(arg):
        return get_placement(entities, arg) if arg and arg.startswith('#') else None

    # ---- complex instance: (BOUNDED_SURFACE() B_SPLINE_SURFACE(...) ...) ----
    # A complex instance is a *collection* of components that together describe
    # one surface (e.g. the bounded/rational b-spline form an AP242 translator
    # emits). The geometry lives in its components, so read it from them instead
    # of reporting the face unsupported (which dropped the face and left the
    # solid open).
    if is_complex_instance(e):
        parts = complex_components(e)
        comp_map = {n: a for n, a in parts}

        def cargs(name):
            return comp_map.get(name)

        if 'B_SPLINE_SURFACE_WITH_KNOTS' in comp_map:
            base = {'type': 'B_SPLINE_SURFACE_WITH_KNOTS'}
            knt = cargs('B_SPLINE_SURFACE_WITH_KNOTS') or []
            bsc = cargs('B_SPLINE_SURFACE')
            # B_SPLINE_SURFACE(degree, degree, control_points, surface_form,
            #                  u_closed, v_closed, self_intersect)
            if bsc and len(bsc) >= 7:
                base['uDegree'] = int(float(bsc[0]))
                base['vDegree'] = int(float(bsc[1]))
                base['controlPoints'] = points_grid(bsc[2])
                base['form'] = bsc[3].replace('.', '').strip()
                base['uClosed'] = logical_flag(bsc[4])
                base['vClosed'] = logical_flag(bsc[5])
                base['selfIntersect'] = logical_flag(bsc[6])
            if len(knt) >= 2:
                base['uMultiplicities'] = _ints(knt[0])
                base['vMultiplicities'] = _ints(knt[1])
            if len(knt) >= 3:
                base['uKnots'] = _numlist(knt[2])
            if len(knt) >= 4:
                base['vKnots'] = _numlist(knt[3])
            if len(knt) >= 5:
                base['knotSpec'] = knt[4].replace('.', '').strip()
            rat = cargs('RATIONAL_B_SPLINE_SURFACE')
            if rat:
                base['weights'] = [[float(x) for x in re.findall(
                    r'[-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?', row)]
                    for row in re.findall(r'\(([^()]*)\)', rat[0])]
            return base
        # Other complex forms: rebuild an equivalent single-entity statement
        # (with the mandatory name argument) and let the simple path parse it.
        for name in ('B_SPLINE_SURFACE', 'SURFACE_OF_REVOLUTION',
                     'SURFACE_OF_LINEAR_EXTRUSION', 'RECTANGULAR_TRIMMED_SURFACE',
                     'CURVE_BOUNDED_SURFACE', 'TOROIDAL_SURFACE',
                     'SPHERICAL_SURFACE', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE'):
            if name in comp_map:
                comps_args = comp_map[name]
                stmt = "%s('',%s)" % (name, ','.join(comps_args))
                e = {'id': e['id'], 'type': name, 'stmt': stmt,
                     'refs': re.findall(r'#\d+', stmt)}
                break
        else:
            return {'type': parts[0][0] if parts else (e['type'] or 'COMPLEX_SURFACE'),
                    'unsupported': True}

    t, args = e['type'], entity_args(e)
    if args is None:
        return {'type': t, 'unsupported': True}
    try:
        if t == 'PLANE' and len(args) >= 2:
            return {'type': 'PLANE', 'placement': get_placement(entities, args[1])}
        if t == 'CYLINDRICAL_SURFACE' and len(args) >= 3:
            return {'type': 'CYLINDRICAL_SURFACE', 'placement': get_placement(entities, args[1]),
                    'radius': float(args[2])}
        if t == 'CONICAL_SURFACE' and len(args) >= 4:
            return {'type': 'CONICAL_SURFACE', 'placement': get_placement(entities, args[1]),
                    'radius': float(args[2]),
                    'semiAngleRad': float(args[3]) * angle_scale}
        if t == 'SPHERICAL_SURFACE' and len(args) >= 3:
            return {'type': 'SPHERICAL_SURFACE', 'placement': get_placement(entities, args[1]),
                    'radius': float(args[2])}
        if t == 'TOROIDAL_SURFACE' and len(args) >= 4:
            return {'type': 'TOROIDAL_SURFACE', 'placement': get_placement(entities, args[1]),
                    'majorRadius': float(args[2]), 'minorRadius': float(args[3])}
        if t == 'DEGENERATE_TOROIDAL_SURFACE' and len(args) >= 4:
            return {'type': 'DEGENERATE_TOROIDAL_SURFACE',
                    'placement': get_placement(entities, args[1]),
                    'majorRadius': float(args[2]), 'minorRadius': float(args[3])}
        # ---- B_SPLINE_SURFACE_WITH_KNOTS(name,uDeg,vDeg,grid,form,uClosed,    ----
        #    vClosed,selfInt,uMult,vMult,uKnots,vKnots,knotSpec)                ----
        if t == 'B_SPLINE_SURFACE_WITH_KNOTS' and len(args) >= 13:
            return {'type': 'B_SPLINE_SURFACE_WITH_KNOTS',
                    'uDegree': int(float(args[1])), 'vDegree': int(float(args[2])),
                    'controlPoints': points_grid(args[3]),
                    'form': args[4].replace('.', '').strip(),
                    'uClosed': logical_flag(args[5]),
                    'vClosed': logical_flag(args[6]),
                    'selfIntersect': logical_flag(args[7]),
                    'uMultiplicities': _ints(args[8]), 'vMultiplicities': _ints(args[9]),
                    'uKnots': _numlist(args[10]), 'vKnots': _numlist(args[11]),
                    'knotSpec': args[12].replace('.', '').strip()}
        if t == 'B_SPLINE_SURFACE' and len(args) >= 7:
            return {'type': 'B_SPLINE_SURFACE',
                    'uDegree': int(float(args[1])), 'vDegree': int(float(args[2])),
                    'controlPoints': points_grid(args[3]),
                    'form': args[4].replace('.', '').strip(),
                    'uClosed': logical_flag(args[5]),
                    'vClosed': logical_flag(args[6]),
                    'selfIntersect': logical_flag(args[7] if len(args) > 7 else None)}
        # ---- swept surfaces ----
        if t == 'SURFACE_OF_REVOLUTION' and len(args) >= 3:
            return {'type': 'SURFACE_OF_REVOLUTION',
                    'sweptCurve': args[1] if args[1].startswith('#') else None,
                    'axis': get_placement(entities, args[2]) if args[2].startswith('#') else None}
        if t == 'SURFACE_OF_LINEAR_EXTRUSION' and len(args) >= 3:
            return {'type': 'SURFACE_OF_LINEAR_EXTRUSION',
                    'sweptCurve': args[1] if args[1].startswith('#') else None,
                    'extrusionAxis': args[2] if args[2].startswith('#') else None}
        # ---- trimmed / bounded surfaces: capture the basis surface ----
        if t == 'RECTANGULAR_TRIMMED_SURFACE' and len(args) >= 2:
            return {'type': 'RECTANGULAR_TRIMMED_SURFACE',
                    'basisSurface': get_surface(entities, args[1], angle_scale)
                    if args[1].startswith('#') else None,
                    'u1': float(args[2]) if len(args) > 2 else None,
                    'u2': float(args[3]) if len(args) > 3 else None,
                    'v1': float(args[4]) if len(args) > 4 else None,
                    'v2': float(args[5]) if len(args) > 5 else None,
                    'usense': len(args) > 6 and args[6].strip().upper() == '.T.',
                    'vsense': len(args) > 7 and args[7].strip().upper() == '.T.'}
        if t == 'CURVE_BOUNDED_SURFACE' and len(args) >= 3:
            return {'type': 'CURVE_BOUNDED_SURFACE',
                    'basisSurface': get_surface(entities, args[1], angle_scale)
                    if args[1].startswith('#') else None,
                    'boundaries': [r for r in re.findall(r'#\d+', args[2])]}
        if t in SURFACE_TYPES:
            return {'type': t, 'unsupported': True}
    except (ValueError, TypeError, IndexError):
        return {'type': t, 'unsupported': True}
    return None


def get_curve(entities, ref):
    """Extract a rebuildable description of an EDGE_CURVE geometry entity.

    Handles the simple cases needed for a faithful round trip (LINE, CIRCLE) and
    B_SPLINE_CURVE_WITH_KNOTS, including the rational (complex) form. Anything
    else is reported with its type only -- never guessed -- so the rebuilder can
    flag it rather than invent geometry.
    """
    e = entities.get(ref)
    if not e:
        return None
    stmt = e['stmt']
    comps = None
    if is_complex_instance(e):
        comps = complex_components(e)
        names = [c[0] for c in comps]
        if 'B_SPLINE_CURVE_WITH_KNOTS' not in names and 'B_SPLINE_CURVE' not in names:
            return {'type': names[0] if names else e['type'], 'unsupported': True}

    def comp_args(name):
        if comps is None:
            return entity_args(e) if e['type'] == name else None
        for n, a in comps:
            if n == name:
                return a
        return None

    # ---- LINE(name, cartesian_point, vector) ----
    if comps is None and e['type'] == 'LINE':
        args = entity_args(e) or []
        if len(args) < 3:
            return {'type': 'LINE', 'unsupported': True}
        p = get_point(entities, args[1])
        v = entities.get(args[2])
        vargs = entity_args(v) or [] if v else []
        d = get_direction(entities, vargs[1]) if len(vargs) > 1 else None
        mag = 1.0
        if len(vargs) > 2:
            fm = FLOAT_RE.search(vargs[2])
            mag = float(fm.group(0)) if fm else 1.0
        # keep the raw (non-normalised) vector so the rebuilt VECTOR matches
        raw = None
        if v:
            m = re.search(r"DIRECTION\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)", v['stmt'])
            if m:
                try:
                    vals = [float(x) for x in m.group(1).split(',')]
                    raw = vals if len(vals) == 3 else None
                except ValueError:
                    raw = None
        return {'type': 'LINE', 'point': p, 'direction': raw or d, 'magnitude': mag,
                'unitDirection': d}

    # ---- CIRCLE(name, axis2_placement_3d, radius) ----
    if comps is None and e['type'] in ('CIRCLE', 'ELLIPSE'):
        args = entity_args(e) or []
        if len(args) < 3:
            return {'type': e['type'], 'unsupported': True}
        pl = get_placement(entities, args[1])
        rec = {'type': e['type'], 'placement': pl, 'radius': float(args[2])}
        if e['type'] == 'ELLIPSE' and len(args) > 3:
            rec['semiAxis2'] = float(args[3])
        return rec

    # ---- B_SPLINE_CURVE / B_SPLINE_CURVE_WITH_KNOTS (+ RATIONAL_B_SPLINE_CURVE) ----
    # Simple entity: B_SPLINE_CURVE_WITH_KNOTS(name, degree, points, form, closed,
    #   self_intersect, multiplicities, knots, knot_spec)
    # Complex entity: components B_SPLINE_CURVE(degree, points, form, closed,
    #   self_intersect), B_SPLINE_CURVE_WITH_KNOTS(multiplicities, knots, spec),
    #   RATIONAL_B_SPLINE_CURVE(weights).
    rec = {'type': 'B_SPLINE_CURVE_WITH_KNOTS'}
    if comps is None and e['type'] == 'B_SPLINE_CURVE_WITH_KNOTS':
        a = entity_args(e)
        if not a or len(a) < 9:
            return {'type': e['type'], 'unsupported': True}
        rec['degree'] = int(float(a[1]))
        rec['controlPoints'] = [get_point(entities, c) for c in re.findall(r'#\d+', a[2])]
        rec['form'] = a[3].replace('.', '').strip()
        rec['closed'] = logical_flag(a[4])
        rec['selfIntersect'] = logical_flag(a[5])
        rec['knotMultiplicities'] = [int(float(x)) for x in re.findall(r'-?\d+', a[6])]
        rec['knots'] = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:[Ee][-+]?\d+)?', a[7])]
        rec['knotSpec'] = a[8].replace('.', '').strip()
        return rec
    bsc = comp_args('B_SPLINE_CURVE') if comps is not None else None
    knt = comp_args('B_SPLINE_CURVE_WITH_KNOTS') if comps is not None else None
    if bsc is None and knt is None:
        return {'type': e['type'], 'unsupported': True}
    # B_SPLINE_CURVE(degree, points, form, closed, self_intersect) -- 5 args.
    # Some writers (and our own rebuilder, historically) include the entity name
    # as a leading argument; drop a leading string literal if present.
    if bsc and bsc[0].startswith("'"):
        bsc = bsc[1:]
    if bsc and len(bsc) >= 5:
        rec['degree'] = int(float(bsc[0]))
        rec['controlPoints'] = [get_point(entities, c) for c in re.findall(r'#\d+', bsc[1])]
        rec['form'] = bsc[2].replace('.', '').strip()
        rec['closed'] = logical_flag(bsc[3])
        rec['selfIntersect'] = logical_flag(bsc[4])
    if knt and len(knt) >= 3:
        rec['knotMultiplicities'] = [int(float(x)) for x in re.findall(r'-?\d+', knt[0])]
        rec['knots'] = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:[Ee][-+]?\d+)?', knt[1])]
        rec['knotSpec'] = knt[2].replace('.', '').strip()
    rat = comp_args('RATIONAL_B_SPLINE_CURVE') if comps is not None else None
    if rat and rat:
        rec['weights'] = [float(x) for x in re.findall(r'-?\d+\.?\d*(?:[Ee][-+]?\d+)?', rat[0])]
    if 'degree' not in rec or not rec.get('controlPoints'):
        return {'type': e['type'], 'unsupported': True}
    return rec


def _bspline_basis(degree, knots, mults, u):
    """Evaluate all non-zero B-spline basis functions N_{i,p}(u).

    Returns a list of (i, N_{i,p}) for the basis functions active at ``u``.
    ``knots`` are the distinct knot values and ``mults`` the matching
    multiplicities; the full knot vector is expanded from them.
    """
    full = []
    for kv, m in zip(knots, mults):
        full.extend([kv] * int(m))
    n = len(full) - degree - 1  # number of control points
    if n <= 0:
        return []
    p = degree
    # find span
    span = n - 1
    for i in range(p, n):
        if u < full[i + 1] or i == n - 1:
            span = i
            break
    # de Boor basis
    N = [0.0] * (p + 1)
    N[0] = 1.0
    left = [0.0] * (p + 1)
    right = [0.0] * (p + 1)
    for j in range(1, p + 1):
        left[j] = u - full[span + 1 - j]
        right[j] = full[span + j] - u
        saved = 0.0
        for r in range(j):
            denom = right[r + 1] + left[j - r]
            temp = N[r] / denom if abs(denom) > 1e-15 else 0.0
            N[r] = saved + right[r + 1] * temp
            saved = left[j - r] * temp
        N[j] = saved
    return [(span - p + k, N[k]) for k in range(p + 1)]


def _bspline_surface_eval(surf, u, v):
    """Evaluate S(u,v) and its partial derivatives dS/du, dS/dv.

    Handles non-rational and rational (weighted) B-spline surfaces given the
    control-point grid and per-direction knots/multiplicities stored on ``surf``.
    Returns (point, du, dv) or None when the data is insufficient.
    """
    grid = surf.get('controlPoints')
    uK, vK = surf.get('uKnots'), surf.get('vKnots')
    uM, vM = surf.get('uMultiplicities'), surf.get('vMultiplicities')
    p, q = surf.get('uDegree'), surf.get('vDegree')
    if not grid or not uK or not vK or not uM or not vM or p is None or q is None:
        return None
    weights = surf.get('weights')
    # normalize grid to rows x cols of coordinates
    U = _bspline_basis(p, uK, uM, u)
    V = _bspline_basis(q, vK, vM, v)
    if not U or not V:
        return None

    def coords(i, j):
        try:
            c = grid[i][j]
        except IndexError:
            return None
        return c

    def weight(i, j):
        if not weights:
            return 1.0
        try:
            return weights[i][j]
        except (IndexError, TypeError):
            return 1.0

    numP = [0.0, 0.0, 0.0]
    denomW = 0.0
    for i, Nu in U:
        for j, Nv in V:
            c = coords(i, j)
            if c is None:
                continue
            w = weight(i, j)
            b = Nu * Nv * w
            for k in range(3):
                numP[k] += b * c[k]
            denomW += b
    if abs(denomW) < 1e-15:
        return None
    P = [x / denomW for x in numP]

    # derivatives by finite difference of the rational surface (robust and
    # sufficient for a normal direction at a boundary point).
    h = 1e-4

    def eval_pt(uu, vv):
        UU = _bspline_basis(p, uK, uM, uu)
        VV = _bspline_basis(q, vK, vM, vv)
        if not UU or not VV:
            return None
        np_ = [0.0, 0.0, 0.0]
        dw = 0.0
        for i, Nu in UU:
            for j, Nv in VV:
                c = coords(i, j)
                if c is None:
                    continue
                w = weight(i, j)
                b = Nu * Nv * w
                for k in range(3):
                    np_[k] += b * c[k]
                dw += b
        if abs(dw) < 1e-15:
            return None
        return [x / dw for x in np_]

    du = eval_pt(min(u + h, 1.0), v)
    du0 = eval_pt(max(u - h, 0.0), v)
    dv = eval_pt(u, min(v + h, 1.0))
    dv0 = eval_pt(u, max(v - h, 0.0))
    if not all((du, du0, dv, dv0)):
        return None
    duv = [(du[k] - du0[k]) for k in range(3)]
    dvv = [(dv[k] - dv0[k]) for k in range(3)]
    return P, duv, dvv


def _closest_uv_on_bspline(surf, p, samples=25):
    """Coarse grid search for the (u,v) whose surface point is nearest ``p``.

    The points fed in are edge/vertex points that lie (to modelling tolerance)
    on the surface, so a dense grid search plus a local refine is enough to
    recover the parameters used for the normal and derivatives.
    """
    best = None
    for iu in range(samples + 1):
        u = iu / samples
        for iv in range(samples + 1):
            v = iv / samples
            r = _bspline_surface_eval(surf, u, v)
            if not r:
                continue
            d = norm(sub(r[0], p))
            if best is None or d < best[0]:
                best = (d, u, v)
    if best is None:
        return None
    # local refine
    _, u, v = best
    step = 1.0 / samples
    for _ in range(40):
        improved = False
        for du, dv in ((step, 0), (-step, 0), (0, step), (0, -step)):
            uu = min(1.0, max(0.0, u + du))
            vv = min(1.0, max(0.0, v + dv))
            r = _bspline_surface_eval(surf, uu, vv)
            if not r:
                continue
            d = norm(sub(r[0], p))
            if d < best[0] - 1e-12:
                best = (d, uu, vv)
                u, v = uu, vv
                improved = True
        if not improved:
            step *= 0.5
            if step < 1e-7:
                break
    return best[1], best[2]


def surface_natural_normal_at(surf, p):
    """Natural (unoriented) surface normal at point ``p`` (on the surface).

    Supports every analytic surface the exporter can carry (plane, cylinder,
    cone, sphere, torus) plus B-spline surfaces via S_u x S_v. Returns None
    only when the geometry genuinely cannot be evaluated -- never a guess.
    """
    if not surf:
        return None
    T = surf['type']
    pl = surf.get('placement')

    if T == 'PLANE':
        if not pl:
            return None
        return list(pl[1])
    if T == 'CYLINDRICAL_SURFACE':
        if not pl:
            return None
        origin, axis, _ = pl
        c = project_on_axis(p, origin, axis)
        return normalize(sub(p, c))
    if T == 'SPHERICAL_SURFACE':
        if not pl:
            return None
        return normalize(sub(p, pl[0]))
    if T == 'CONICAL_SURFACE':
        if not pl:
            return None
        origin, axis, _ = pl
        semi = surf.get('semiAngleRad', 0.0)
        # axis direction points to the apex side; generator from apex
        c = project_on_axis(p, origin, axis)
        radial = sub(p, c)
        rn = norm(radial)
        if rn < 1e-12:
            return None
        radial_u = [x / rn for x in radial]
        # normal = cos(semi)*radial_u - sin(semi)*axis
        n = [math.cos(semi) * radial_u[i] - math.sin(semi) * axis[i] for i in range(3)]
        return normalize(n)
    if T == 'TOROIDAL_SURFACE':
        if not pl:
            return None
        origin, axis, _ = pl
        major = surf.get('majorRadius', 0.0)
        c = project_on_axis(p, origin, axis)
        radial = sub(p, c)
        rn = norm(radial)
        if rn < 1e-12:
            return None
        radial_u = [x / rn for x in radial]
        # nearest point on the major circle
        center = [origin[i] + major * radial_u[i] for i in range(3)]
        return normalize(sub(p, center))
    if T in ('B_SPLINE_SURFACE_WITH_KNOTS', 'B_SPLINE_SURFACE', 'RATIONAL_B_SPLINE_SURFACE'):
        uv = _closest_uv_on_bspline(surf, p)
        if uv is None:
            return None
        r = _bspline_surface_eval(surf, uv[0], uv[1])
        if not r:
            return None
        _, du, dv = r
        n = cross(du, dv)
        if norm(n) < 1e-12:
            return None
        return normalize(n)
    return None  # swept / trimmed / curve-bounded: not attempted (never guess)


def _bspline_curve_eval(cd, u):
    """Evaluate C(u) and dC/du for a B_SPLINE_CURVE_WITH_KNOTS description.

    ``cd`` is the graph curve record (degree, controlPoints, knots,
    knotMultiplicities, optional weights). Returns (point, tangent) or None.
    """
    pts = cd.get('controlPoints')
    knots = cd.get('knots')
    mults = cd.get('knotMultiplicities')
    deg = cd.get('degree')
    if not pts or not knots or not mults or deg is None:
        return None
    if any(p is None for p in pts):
        return None
    weights = cd.get('weights')
    basis = _bspline_basis(deg, knots, mults, u)

    def eval_at(uu):
        B = _bspline_basis(deg, knots, mults, uu)
        if not B:
            return None
        num = [0.0, 0.0, 0.0]
        den = 0.0
        for i, Ni in B:
            if i >= len(pts):
                continue
            w = weights[i] if (weights and i < len(weights)) else 1.0
            b = Ni * w
            for k in range(3):
                num[k] += b * pts[i][k]
            den += b
        if abs(den) < 1e-15:
            return None
        return [x / den for x in num]

    P = eval_at(u)
    if P is None:
        return None
    h = 1e-4
    a = eval_at(min(u + h, 1.0))
    b = eval_at(max(u - h, 0.0))
    if a is None or b is None:
        return None
    tan = normalize([a[k] - b[k] for k in range(3)])
    if tan is None:
        return None
    return P, tan


def _closest_u_on_bspline_curve(cd, p, samples=100):
    pts = cd.get('controlPoints')
    if not pts or any(x is None for x in pts):
        return None
    best = None
    for i in range(samples + 1):
        u = i / samples
        r = _bspline_curve_eval(cd, u)
        if not r:
            continue
        d = norm(sub(r[0], p))
        if best is None or d < best[0]:
            best = (d, u)
    if best is None:
        return None
    _, u = best
    step = 1.0 / samples
    for _ in range(40):
        improved = False
        for du in (step, -step):
            uu = min(1.0, max(0.0, u + du))
            r = _bspline_curve_eval(cd, uu)
            if not r:
                continue
            d = norm(sub(r[0], p))
            if d < best[0] - 1e-12:
                best = (d, uu)
                u = uu
                improved = True
        if not improved:
            step *= 0.5
            if step < 1e-7:
                break
    return best[1]


def curve_tangent(entities, geom_ref, same_sense, p):
    e = entities.get(geom_ref)
    if not e:
        return None, 'geometry-missing'
    t, args = e['type'], entity_args(e)
    try:
        if t == 'LINE':
            if args is None or len(args) < 3:
                return None, 'line-args-missing'
            v = entities.get(args[2]) if len(args) > 2 else None
            if not v:
                return None, 'line-vector-missing'
            vargs = entity_args(v) or []
            d = get_direction(entities, vargs[1]) if len(vargs) > 1 and vargs[1].startswith('#') else None
            if d is None:
                return None, 'line-direction-missing'
            mag = 1.0
            if len(vargs) > 2:
                fm = FLOAT_RE.search(vargs[2])
                mag = float(fm.group(0)) if fm else 1.0
            if abs(mag) < 1e-15:
                return None, 'line-vector-zero'
            tv = [x * mag for x in d]
            n = norm(tv)
            tt = [x / n for x in tv]
            if not same_sense:
                tt = [-x for x in tt]
            return tt, None
        if t in ('CIRCLE', 'ELLIPSE'):
            pl = get_placement(entities, args[1]) if args and len(args) > 1 else None
            if not pl:
                return None, 'circle-placement-missing'
            center, axis, xdir = pl
            if t == 'CIRCLE':
                radial = sub(p, center)
                if norm(radial) < 1e-12:
                    r = float(args[2]) if len(args) > 2 else None
                    if r is None:
                        return None, 'circle-radius-missing'
                    radial = [r * x for x in xdir]
                tt = normalize(cross(axis, radial))
            else:
                # ellipse: parameterise and take the tangent from the closest point
                a1 = float(args[2]) if len(args) > 2 else None
                a2 = float(args[3]) if len(args) > 3 else None
                if not a1 or not a2:
                    return None, 'ellipse-axes-missing'
                ydir = cross(axis, xdir)
                d = sub(p, center)
                ux, uy = dot(d, xdir), dot(d, ydir)
                th = math.atan2(uy / a2, ux / a1)
                tt = normalize([-a1 * math.sin(th) * xdir[k] + a2 * math.cos(th) * ydir[k]
                                for k in range(3)])
            if tt is None:
                return None, 'tangent-degenerate'
            if not same_sense:
                tt = [-x for x in tt]
            return tt, None
        if t == 'B_SPLINE_CURVE_WITH_KNOTS' or is_complex_instance(e):
            cd = get_curve(entities, geom_ref)
            if cd and cd.get('controlPoints') and not cd.get('unsupported'):
                u = _closest_u_on_bspline_curve(cd, p)
                if u is not None:
                    r = _bspline_curve_eval(cd, u)
                    if r:
                        tt = r[1]
                        if not same_sense:
                            tt = [-x for x in tt]
                        return tt, None
            return None, 'spline-tangent-unresolved'
        return None, 'curve-type-unsupported:%s' % t
    except (ValueError, TypeError, IndexError):
        return None, 'curve-parse-error'

# ---------------------------------------------------------------- units

def length_scale_to_mm(entities, order):
    def prefix_scale(tok):
        powers = {'EXA': 1e18, 'PETA': 1e15, 'TERA': 1e12, 'GIGA': 1e9, 'MEGA': 1e6,
                  'KILO': 1e3, 'HECTO': 1e2, 'DECA': 1e1, '$': 1, 'DECI': 1e-1,
                  'CENTI': 1e-2, 'MILLI': 1e-3, 'MICRO': 1e-6, 'NANO': 1e-9,
                  'PICO': 1e-12, 'FEMTO': 1e-15, 'ATTO': 1e-18}
        return powers.get(tok.replace('.', '').strip().upper())

    def resolve(unit_id, depth=0):
        if depth > 6:
            return None
        e = entities.get(unit_id)
        if not e:
            return None
        if 'CONVERSION_BASED_UNIT' in e['stmt']:
            if 'INCH' in e['stmt'].upper():
                return 25.4
            for r in e['refs']:
                m = entities.get(r)
                if m and 'MEASURE_WITH_UNIT' in m['stmt'].upper():
                    fm = FLOAT_RE.search(m['stmt'])
                    if fm:
                        inner = 1.0
                        for r2 in m['refs']:
                            if r2 != unit_id:
                                s = resolve(r2, depth + 1)
                                if s:
                                    inner = s
                                    break
                        return float(fm.group(0)) * inner
        sm = re.search(r"SI_UNIT\s*\(\s*(\$|\.[A-Z_]+\.?)\s*,\s*\.METRE\.\s*\)", e['stmt'])
        if sm and ('LENGTH_UNIT' in e['stmt']):
            s = prefix_scale(sm.group(1))
            if s:
                return s * 1000.0
        return None

    for eid in order:
        e = entities[eid]
        if 'GEOMETRIC_REPRESENTATION_CONTEXT' in e['stmt'] and 'GLOBAL_UNIT_ASSIGNED_CONTEXT' in e['stmt']:
            for r in e['refs']:
                s = resolve(r)
                if s:
                    return s
    for eid in order:
        s = resolve(eid)
        if s:
            return s
    return 1.0

def plane_angle_scale_to_radians(entities, order):
    """Return the factor that converts a plane-angle value in this file to radians.

    STEP stores angular quantities (e.g. ``CONICAL_SURFACE``'s semi-angle) in the
    file's plane-angle unit, which is not always radians: NIST/AP203 files
    declare ``CONVERSION_BASED_UNIT('DEGREE', ...)``. Reading such a value as if
    it were radians turns a 59 degree cone into a 59 radian cone, which then
    fails to rebuild. Mirror ``length_scale_to_mm`` and normalise to radians.
    """
    def resolve(unit_id, depth=0):
        if depth > 6:
            return None
        e = entities.get(unit_id)
        if not e or 'PLANE_ANGLE_UNIT' not in e['stmt']:
            return None
        if 'CONVERSION_BASED_UNIT' in e['stmt']:
            if 'DEGREE' in e['stmt'].upper() and 'RADIAN' not in e['stmt'].upper():
                return math.pi / 180.0
            for r in e['refs']:
                m = entities.get(r)
                if m and 'MEASURE_WITH_UNIT' in m['stmt'].upper():
                    fm = FLOAT_RE.search(m['stmt'])
                    if fm:
                        inner = 1.0
                        for r2 in m['refs']:
                            if r2 != unit_id:
                                s = resolve(r2, depth + 1)
                                if s:
                                    inner = s
                                    break
                        return float(fm.group(0)) * inner
        sm = re.search(r"SI_UNIT\s*\(\s*(\$|\.[A-Z_]+\.?)\s*,\s*\.RADIAN\.\s*\)", e['stmt'])
        if sm:
            powers = {'EXA': 1e18, 'PETA': 1e15, 'TERA': 1e12, 'GIGA': 1e9, 'MEGA': 1e6,
                      'KILO': 1e3, 'HECTO': 1e2, 'DECA': 1e1, '$': 1, 'DECI': 1e-1,
                      'CENTI': 1e-2, 'MILLI': 1e-3, 'MICRO': 1e-6, 'NANO': 1e-9,
                      'PICO': 1e-12, 'FEMTO': 1e-15, 'ATTO': 1e-18}
            s = powers.get(sm.group(1).replace('.', '').strip().upper())
            if s:
                return s
        return None

    for eid in order:
        e = entities[eid]
        if 'GEOMETRIC_REPRESENTATION_CONTEXT' in e['stmt'] and 'GLOBAL_UNIT_ASSIGNED_CONTEXT' in e['stmt']:
            for r in e['refs']:
                s = resolve(r)
                if s:
                    return s
    for eid in order:
        s = resolve(eid)
        if s:
            return s
    return 1.0


def part_shell_ids(entities, order):
    """Return the shells that make up the part's B-Rep.

    A file may also carry auxiliary geometry (e.g. a ``SHELL_BASED_SURFACE_MODEL``
    "fill" surface) that is *not* part of the solid. Walking every shell would
    export those too and the rebuilder would turn them into extra bodies. This is
    the single source of truth for the selection rule, shared by the exporter and
    the truth-anchored validator:

    * shells referenced by a solid (``MANIFOLD_SOLID_BREP`` / ``BREP_WITH_VOIDS``
      / ``FACETED_BREP`` / ``TESSELLATED_SOLID``) win;
    * otherwise shells referenced by a surface-model representation;
    * otherwise the empty set, meaning "no part shell declared" (callers fall
      back to every shell).
    """
    solid = set()
    model = set()
    for eid in order:
        e = entities[eid]
        if e['type'] in ('MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS',
                         'FACETED_BREP', 'TESSELLATED_SOLID'):
            for r in e['refs']:
                if entities.get(r, {}).get('type') in ('CLOSED_SHELL', 'OPEN_SHELL'):
                    solid.add(r)
        elif e['type'] in ('SHELL_BASED_SURFACE_MODEL', 'FACE_BASED_SURFACE_MODEL'):
            for r in e['refs']:
                if entities.get(r, {}).get('type') in ('CLOSED_SHELL', 'OPEN_SHELL'):
                    model.add(r)
    # Solids take precedence: when a file declares both a solid and an auxiliary
    # surface model, the solid is the part.
    return solid or model

# ---------------------------------------------------------------- main

def main(src, out_dir=None):
    """Export ``src`` and write the graph + two adjacency matrices.

    ``out_dir`` defaults to the directory that contains ``src``.  Returns a
    dict with the three written paths and the graph itself.
    """
    out_dir = out_dir or os.path.dirname(os.path.abspath(src))
    os.makedirs(out_dir, exist_ok=True)
    text = open(src, 'r', encoding='utf-8', errors='replace').read()
    entities, order = parse_step(text)
    scale_mm = length_scale_to_mm(entities, order)
    angle_scale = plane_angle_scale_to_radians(entities, order)
    unit_name = 'inch' if abs(scale_mm - 25.4) < 1e-9 else ('mm' if abs(scale_mm - 1.0) < 1e-9 else 'x%.6g mm' % scale_mm)
    schema_m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text)
    schema = schema_m.group(1) if schema_m else 'unknown'

    # ---- faces (topology walk) ----
    # Walking *every* shell in the file is wrong when the file also contains
    # auxiliary geometry (e.g. a SHELL_BASED_SURFACE_MODEL "fill" surface that
    # is not part of the solid): those extra shells would be exported and then
    # rebuilt as solid bodies, i.e. "extra surfaces". ``part_shell_ids`` selects
    # the shells that actually belong to the part's B-Rep and falls back to every
    # shell only when the file declares no such reference at all.
    part_shells = part_shell_ids(entities, order)
    face_ids = []
    for eid in order:
        e = entities[eid]
        if e['type'] not in ('CLOSED_SHELL', 'OPEN_SHELL'):
            continue
        if part_shells and eid not in part_shells:
            continue
        for r in e['refs']:
            if entities.get(r, {}).get('type') in ('ADVANCED_FACE', 'FACE_SURFACE') and r not in face_ids:
                face_ids.append(r)
    if not face_ids:
        for eid in order:
            if entities[eid]['type'] in ('ADVANCED_FACE', 'FACE_SURFACE'):
                face_ids.append(eid)
    face_index = {fid: i for i, fid in enumerate(face_ids)}

    # ---- tessellated representation (TESSELLATED_SOLID / TRIANGULATED_FACE) ----
    # A file may carry a tessellated solid instead of (or in addition to) the
    # classic ADVANCED_FACE B-Rep. Reading only the classic route would emit an
    # *empty* graph for such a solid -- a misrepresentation, not a faithful
    # export. The tessellation is captured verbatim so the graph always carries
    # the actual geometry the file defines.
    tess = parse_tessellated(entities, order)
    # A faceted B-rep that merely restates the tessellation (same triangles) is
    # an alternative representation of one surface, not extra topology.
    derived_faces = derived_faceted_faces(entities, order, tess)
    derived_shells = set()
    if derived_faces:
        face_ids = [fid for fid in face_ids if fid not in derived_faces]
        # shells that held only those derived faces are not part of the model
        derived_shells = {eid for eid in order
                          if entities[eid]['type'] in ('CLOSED_SHELL', 'OPEN_SHELL')
                          and entities[eid]['refs']
                          and all(r in derived_faces for r in entities[eid]['refs'])}
    representation = 'brep'
    if face_ids and tess:
        representation = 'mixed'
    elif tess and not face_ids:
        representation = 'tessellated'
    elif not face_ids and not tess:
        # no solid geometry at all (e.g. a pure-PMI / annotation file)
        representation = 'empty'

    # ---- walk faces -> bounds -> loops -> oriented edges ----
    edge_info = {}
    face_meta = {}
    traversal = {}
    loop_count_total = 0
    apex_vids = set()

    for fid in face_ids:
        fe = entities[fid]
        fargs = entity_args(fe) or []
        surf_ref, same_sense, bound_refs = None, True, []
        for a in fargs:
            if a.startswith('(') and '#' in a:
                bound_refs = re.findall(r'#\d+', a)
            elif a.startswith('#') and entities.get(a, {}).get('type') in SURFACE_TYPES:
                surf_ref = a
        if len(fargs) >= 4:
            same_sense = fargs[3].strip().upper() == '.T.'
        if surf_ref is None:
            known = set(bound_refs)
            for r in fe['refs']:
                if r not in known and entities.get(r, {}).get('type') in SURFACE_TYPES:
                    surf_ref = r
                    break
        loops_n = bcount = 0
        fbounds = []
        for br in bound_refs:
            be = entities.get(br)
            if not be or be['type'] not in ('FACE_BOUND', 'FACE_OUTER_BOUND'):
                continue
            bargs = entity_args(be) or []
            b_sign = -1 if (len(bargs) >= 3 and bargs[2].strip().upper() == '.F.') else +1
            loop_ref = None
            for r in be['refs']:
                if entities.get(r, {}).get('type') in ('EDGE_LOOP', 'VERTEX_LOOP'):
                    loop_ref = r
                    break
            if not loop_ref:
                continue
            le = entities.get(loop_ref)
            loops_n += 1
            loop_count_total += 1
            if le['type'] == 'VERTEX_LOOP':
                apo = le['refs'][0] if le['refs'] else None
                if apo:
                    apex_vids.add(apo)
                fbounds.append({'outer': be['type'] == 'FACE_OUTER_BOUND',
                                'orientation': b_sign > 0, 'vertexLoop': True,
                                'vertexLoopVtx': apo, 'edges': []})
                continue
            bound_edges = []
            for oe_ref in le['refs']:
                oe = entities.get(oe_ref)
                if not oe or oe['type'] != 'ORIENTED_EDGE':
                    continue
                oargs = entity_args(oe) or []
                oe_sign = -1 if (len(oargs) >= 5 and oargs[4].strip().upper() == '.F.') else +1
                edge_ref = None
                for r in oe['refs']:
                    if entities.get(r, {}).get('type') == 'EDGE_CURVE':
                        edge_ref = r
                        break
                if not edge_ref:
                    continue
                bcount += 1
                bound_edges.append((edge_ref, oe_sign > 0))
                traversal[(fid, edge_ref)] = b_sign * oe_sign
                if edge_ref not in edge_info:
                    ee = entities[edge_ref]
                    eargs = entity_args(ee) or []
                    e_ss = eargs[4].strip().upper() == '.T.' if len(eargs) >= 5 else True
                    edge_info[edge_ref] = {
                        'curveId': eargs[3] if len(eargs) > 3 and eargs[3].startswith('#') else None,
                        'curveType': curve_type_of(entities, eargs[3]) if len(eargs) > 3 and eargs[3].startswith('#') else None,
                        'v1': eargs[1] if len(eargs) > 1 and eargs[1].startswith('#') else None,
                        'v2': eargs[2] if len(eargs) > 2 and eargs[2].startswith('#') else None,
                        'sameSense': e_ss, 'faces': set(), 'loops': set()}
                edge_info[edge_ref]['faces'].add(fid)
                edge_info[edge_ref]['loops'].add(loop_ref)
            fbounds.append({'outer': be['type'] == 'FACE_OUTER_BOUND',
                            'orientation': b_sign > 0, 'edges': bound_edges})
        face_meta[fid] = {'loops': loops_n, 'edgeCount': bcount,
                          'surface': get_surface(entities, surf_ref, angle_scale)
                          if surf_ref else None,
                          'sameSense': same_sense, 'surfaceRef': surf_ref, 'bounds': fbounds}

    def vertex_point(vid):
        if not vid:
            return None
        for r in entities.get(vid, {}).get('refs', []):
            p = get_point(entities, r)
            if p:
                return p
        return None

    # ---- adjacency edges with dihedral/convexity ----
    def edge_candidate_points(info):
        """Candidate points on an edge, ordered so an interior point is tried
        before the endpoints. A cone apex (an edge endpoint on the axis) has an
        undefined surface normal, so evaluating only at a vertex loses the
        dihedral; the edge midpoint is well-defined for the same edge."""
        pts = []
        # 1. interior point on the curve, when we can compute one
        if info['curveId']:
            ce = entities.get(info['curveId'])
            cargs = entity_args(ce) or [] if ce else []
            try:
                if ce and ce['type'] == 'LINE' and len(cargs) > 1:
                    a = get_point(entities, cargs[1])
                    b = vertex_point(info['v2']) or vertex_point(info['v1'])
                    if a and b:
                        pts.append([(a[i] + b[i]) / 2.0 for i in range(3)])
                elif ce and ce['type'] == 'CIRCLE':
                    pl = get_placement(entities, cargs[1]) if len(cargs) > 1 else None
                    if pl and len(cargs) > 2:
                        r = float(cargs[2])
                        # quarter-arc point from the vertex, away from any seam
                        c = pl[0]
                        v = vertex_point(info['v1']) or vertex_point(info['v2'])
                        if v:
                            rad = sub(v, c)
                            rn = norm(rad)
                            if rn > 1e-12:
                                rad_u = [x / rn for x in rad]
                                # rotate 45deg around the axis for a robust point
                                ax = pl[1]
                                ang = math.pi / 4
                                rot = [rad_u[i] * math.cos(ang)
                                       + cross(ax, rad_u)[i] * math.sin(ang)
                                       for i in range(3)]
                                pts.append([c[i] + r * rot[i] for i in range(3)])
            except (ValueError, TypeError, IndexError):
                pass
        # 2. then the endpoints
        for v in (info['v1'], info['v2']):
            pv = vertex_point(v)
            if pv:
                pts.append(pv)
        # 3. then the curve's own defining point
        if info['curveId']:
            ce = entities.get(info['curveId'])
            cargs = entity_args(ce) or [] if ce else []
            if ce and ce['type'] == 'LINE' and len(cargs) > 1:
                pv = get_point(entities, cargs[1])
                if pv:
                    pts.append(pv)
            elif ce and ce['type'] == 'CIRCLE':
                pl = get_placement(entities, cargs[1]) if len(cargs) > 1 else None
                if pl and len(cargs) > 2:
                    try:
                        r = float(cargs[2])
                        pts.append([pl[0][i] + r * pl[2][i] for i in range(3)])
                    except ValueError:
                        pass
        return pts

    adj_records = []
    for eid, info in edge_info.items():
        if len(info['faces']) < 2:
            continue
        faces = sorted(info['faces'], key=lambda f: face_index[f])
        rec = {'edgeId': eid, 'curveType': info['curveType'], 'faces': faces}
        candidates = edge_candidate_points(info)
        rec['point'] = candidates[0] if candidates else None

        reasons = []
        # Evaluate at each candidate until the dihedral resolves (both face
        # normals and the shared-edge tangent defined). Report the first point
        # that succeeds; otherwise report the reasons from the first candidate.
        best = None
        first_reasons = None
        for p in candidates:
            rs, normals, tangents = [], [], []
            for fid in faces:
                fm = face_meta[fid]
                n = surface_natural_normal_at(fm['surface'], p) if fm['surface'] else None
                if n is None:
                    rs.append('surface-normal-undefined:%s' % (
                        fm['surface']['type'] if fm['surface'] else 'none'))
                    normals.append(None)
                else:
                    if not fm['sameSense']:
                        n = [-x for x in n]
                    normals.append(n)
            t_param, why = (curve_tangent(entities, info['curveId'], info['sameSense'], p)
                            if info['curveId'] else (None, 'geometry-missing'))
            if t_param is None:
                rs.append(why or 'tangent-unresolved')
            else:
                for fid in faces:
                    s = traversal.get((fid, eid), +1)
                    tangents.append([x * s for x in t_param])

            if len(normals) == 2 and all(n is not None for n in normals) and len(tangents) == 2:
                n1, n2 = normals
                t1, t2 = tangents
                if dot(t1, t2) > -0.5:
                    rs.append('inconsistent-orientation')
                    best = (p, normals, tangents, None, rs)
                else:
                    c = cross(n1, n2)
                    phi = math.atan2(dot(c, t1), dot(n1, n2))
                    # atan2 returns +/-pi for the same physical fold-back; snap the
                    # ambiguous sign to +pi so the convexity of a near-flat /
                    # 360-degree edge is deterministic across a round trip.
                    if abs(phi + math.pi) < 1e-9:
                        phi = math.pi
                    theta = math.pi - phi
                    conv = 'convex' if phi > TOL_FLAT else ('concave' if phi < -TOL_FLAT else 'flat')
                    best = (p, normals, tangents, (theta, conv, phi), rs)
                break
            if first_reasons is None:
                first_reasons = (p, normals, tangents, rs)

        if best is not None:
            p, normals, tangents, dihedral, rs = best
            rec['point'] = p
            rec['normals'], rec['tangents'] = normals, tangents
            rec['dihedral'] = dihedral
            reasons = rs if dihedral is None else []
        elif first_reasons is not None:
            p, normals, tangents, rs = first_reasons
            rec['point'] = p
            rec['normals'], rec['tangents'] = normals, tangents
            rec['dihedral'] = None
            reasons = rs
        else:
            rec['normals'], rec['tangents'] = [], []
            rec['dihedral'] = None
            reasons = ['edge-point-unresolved']

        rec['unresolvedReasons'] = reasons
        adj_records.append(rec)
    adj_records.sort(key=lambda r: (face_index[r['faces'][0]], face_index[r['faces'][1]], int(r['edgeId'][1:])))

    # ================= PMI =================
    # datums
    datum_letter, datum_nodes = {}, []
    for eid in order:
        e = entities[eid]
        if e['type'] == 'DATUM':
            args = entity_args(e) or []
            letter = args[-1].strip("'") if args else ''
            datum_letter[eid] = letter
            datum_nodes.append({'kind': 'Datum', 'eid': eid, 'letter': letter})
    letter_to_datum = {n['letter']: n['eid'] for n in datum_nodes}

    def resolve_datum_ref(ref, depth=0):
        if depth > 5:
            return []
        e = entities.get(ref)
        if not e:
            return []
        if e['type'] == 'DATUM':
            return [datum_letter.get(ref, '')]
        if e['type'] in ('DATUM_SYSTEM', 'DATUM_REFERENCE', 'DATUM_REFERENCE_ELEMENT',
                         'DATUM_REFERENCE_COMPARTMENT', 'COMMON_DATUM_LIST'):
            out = []
            for r in e['refs']:
                out.extend(resolve_datum_ref(r, depth + 1))
            return out
        return []

    # aspect graph (SHAPE_ASPECT_RELATIONSHIP, both endpoints aspects)
    aspect_adj = defaultdict(set)
    datum_feature_of = {}
    for eid in order:
        e = entities[eid]
        if e['type'] != 'SHAPE_ASPECT_RELATIONSHIP':
            continue
        refs = e['refs']
        a, b = (refs[0], refs[1]) if len(refs) >= 2 else (None, None)
        if not a or not b:
            continue
        ta, tb = entities.get(a, {}).get('type', ''), entities.get(b, {}).get('type', '')
        if is_aspect_type(ta) and is_aspect_type(tb):
            aspect_adj[a].add(b)
            aspect_adj[b].add(a)
        elif ta == 'DATUM_FEATURE' and tb == 'DATUM':
            datum_feature_of[b] = a

    # GISU: aspect -> faces / edges
    gisu_faces, gisu_edges = defaultdict(set), defaultdict(set)
    for eid in order:
        e = entities[eid]
        if e['type'] != 'GEOMETRIC_ITEM_SPECIFIC_USAGE':
            continue
        aspect = None
        for r in e['refs']:
            t = entities.get(r, {}).get('type', '')
            if is_aspect_type(t):
                aspect = r
                break
        if aspect is None:
            continue
        for r in e['refs']:
            t = entities.get(r, {}).get('type', '')
            if t in ('ADVANCED_FACE', 'FACE_SURFACE'):
                gisu_faces[aspect].add(r)
            elif t == 'EDGE_CURVE':
                gisu_edges[aspect].add(r)

    def aspect_closure(a):
        seen, stack = {a}, [a]
        while stack:
            x = stack.pop()
            for y in aspect_adj.get(x, ()):
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        return seen

    def resolve_aspect_targets(a):
        faces, edges = set(), set()
        for x in aspect_closure(a):
            faces |= gisu_faces.get(x, set())
            edges |= gisu_edges.get(x, set())
        return faces, edges

    # dimension values: DCR -> SDR -> items
    def parse_measure_item(item_eid):
        e = entities.get(item_eid)
        if not e:
            return None
        nm = re.search(r"REPRESENTATION_ITEM\s*\(\s*'([^']*)'", e['stmt'])
        fm = FLOAT_RE.search(e['stmt'])
        if not fm:
            return None
        mtype = 'angle' if 'PLANE_ANGLE_MEASURE(' in e['stmt'] else (
            'length' if 'LENGTH_MEASURE(' in e['stmt'] else 'other')
        return {'role': nm.group(1) if nm else 'value',
                'value': float(fm.group(0)), 'measure': mtype}

    sdr_items = {}
    for eid in order:
        e = entities[eid]
        if e['type'] == 'SHAPE_DIMENSION_REPRESENTATION':
            ctx = None
            for r in e['refs']:
                if 'GEOMETRIC_REPRESENTATION_CONTEXT' in entities.get(r, {}).get('stmt', ''):
                    ctx = r
                    break
            sdr_items[eid] = [parse_measure_item(r) for r in e['refs']
                              if r != ctx and parse_measure_item(r)]
    dim_value = {}
    for eid in order:
        e = entities[eid]
        if e['type'] != 'DIMENSIONAL_CHARACTERISTIC_REPRESENTATION':
            continue
        dim_ref = rep_ref = None
        for r in e['refs']:
            t = entities.get(r, {}).get('type', '')
            if t == 'SHAPE_DIMENSION_REPRESENTATION':
                rep_ref = r
            else:
                dim_ref = r
        if dim_ref and rep_ref and rep_ref in sdr_items:
            vals = {}
            for it in sdr_items[rep_ref]:
                if it:
                    role = it['role'].lower()
                    if role.startswith('nominal'):
                        vals['nominal'] = it['value']
                    elif role.startswith('upper'):
                        vals['upper'] = it['value']
                    elif role.startswith('lower'):
                        vals['lower'] = it['value']
                    else:
                        vals.setdefault('other', []).append(it['value'])
            dim_value[dim_ref] = vals

    # PMI nodes
    pmi_nodes = list(datum_nodes)
    drf_nodes = []
    for eid in order:
        e = entities[eid]
        # geometric tolerances (complex)
        if 'GEOMETRIC_TOLERANCE(' in e['stmt'] and is_complex_instance(e):
            name, mag_val, aspect_ref, toltype = '', None, None, 'geometric tolerance'
            drf_ref = None
            for cname, cargs in complex_components(e):
                if cname == 'GEOMETRIC_TOLERANCE' and len(cargs) >= 4:
                    name = cargs[0].strip("'")
                    if cargs[2].startswith('#'):
                        me = entities.get(cargs[2])
                        fm = FLOAT_RE.search(me['stmt']) if me else None
                        if fm:
                            mag_val = float(fm.group(0))
                    if cargs[3].startswith('#'):
                        aspect_ref = cargs[3]
                if cname == 'GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE' and cargs:
                    drf_ref = re.findall(r'#\d+', cargs[0])
                if cname in TOL_TYPE_NAMES:
                    toltype = TOL_TYPE_NAMES[cname]
            datums = []
            for r in (drf_ref or []):
                datums.extend(resolve_datum_ref(r))
            pmi_nodes.append({'kind': 'GeometricTolerance', 'eid': eid, 'name': name,
                              'toleranceType': toltype, 'value': mag_val,
                              'valueMm': round(mag_val * scale_mm, 6) if mag_val is not None else None,
                              'datums': datums, 'aspectRef': aspect_ref, 'drfRefs': drf_ref or []})
        # dimensional sizes (simple): DIMENSIONAL_SIZE(#aspect,'name')
        elif e['type'] == 'DIMENSIONAL_SIZE':
            args = entity_args(e) or []
            aspect_ref = args[0] if args and args[0].startswith('#') else None
            name = args[1].strip("'") if len(args) > 1 else ''
            vals = dim_value.get(eid, {})
            pmi_nodes.append({'kind': 'Dimension', 'eid': eid, 'name': name,
                              'aspectRef': aspect_ref,
                              'nominal': vals.get('nominal'), 'upper': vals.get('upper'),
                              'lower': vals.get('lower'),
                              'nominalMm': round(vals['nominal'] * scale_mm, 6) if vals.get('nominal') is not None else None})

    # DRF (datum system) nodes
    for eid in order:
        e = entities[eid]
        if e['type'] == 'DATUM_SYSTEM':
            args = entity_args(e) or []
            name = args[0].strip("'") if args else ''
            letters = []
            for r in e['refs']:
                letters.extend(resolve_datum_ref(r))
            drf_nodes.append({'eid': eid, 'name': name, 'letters': letters})

    # PMI -> topology edges
    pmi_edges = []
    pmi_res = {'resolved': 0, 'missing': 0}
    for n in sorted(pmi_nodes, key=lambda n: int(n['eid'][1:])):
        aspect = n.get('aspectRef')
        if n['kind'] == 'Datum':
            feat = datum_feature_of.get(n['eid'])
            faces, edges = resolve_aspect_targets(feat) if feat else (set(), set())
        elif aspect:
            faces, edges = resolve_aspect_targets(aspect)
        else:
            faces, edges = set(), set()
        if faces or edges:
            recorded = 0
            for fid in sorted(faces, key=lambda f: face_index.get(f, 1 << 30)):
                # A reference to a face the part B-Rep does not contain (e.g. a
                # SHELL_BASED_SURFACE_MODEL "fill" face that is deliberately not
                # exported) has no node in the graph, so it is not recorded.
                if fid not in face_index:
                    continue
                pmi_edges.append({'kind': 'PMI-Topology', 'pmi': n['eid'], 'target': fid,
                                  'targetType': 'Face', 'resolution': 'resolved',
                                  'resolutionReason': 'shape_aspect_relationship+geometric_item_specific_usage'})
                pmi_res['resolved'] += 1
                recorded += 1
            for xid in sorted(edges, key=lambda x: int(x[1:])):
                pmi_edges.append({'kind': 'PMI-Topology', 'pmi': n['eid'], 'target': xid,
                                  'targetType': 'Edge', 'resolution': 'resolved',
                                  'resolutionReason': 'shape_aspect_relationship+geometric_item_specific_usage'})
                pmi_res['resolved'] += 1
                recorded += 1
            if not recorded:
                # All topology the annotation pointed at was outside the exported
                # part B-Rep, so the annotation has no target in this graph. Record
                # it as unresolved (matching what a re-export of the rebuilt file,
                # which never contained those faces, reports) instead of dropping
                # the node's only resolution record.
                pmi_edges.append({'kind': 'PMI-Topology', 'pmi': n['eid'], 'target': None,
                                  'targetType': None, 'resolution': 'missing',
                                  'resolutionReason': 'target-outside-part-brep'})
                pmi_res['missing'] += 1
        else:
            reason = ('datum-feature-aspect-has-no-gisu-topology-link' if n['kind'] == 'Datum'
                      else ('tolerance-aspect-has-no-gisu-topology-link' if n['kind'] == 'GeometricTolerance'
                            else 'dimension-aspect-has-no-gisu-topology-link'))
            pmi_edges.append({'kind': 'PMI-Topology', 'pmi': n['eid'], 'target': None,
                              'targetType': None, 'resolution': 'missing', 'resolutionReason': reason})
            pmi_res['missing'] += 1

    # ================= graph JSON (deterministic) =================
    nodes = []
    for idx, fid in enumerate(face_ids):
        fm = face_meta[fid]
        st = fm['surface']['type'] if fm['surface'] else 'unknown'
        nodes.append(OrderedDict([
            ('id', 'Face-%d' % idx), ('type', 'Face'), ('stepEntityId', fid),
            ('surfaceType', st), ('sameSense', fm['sameSense']),
            ('loopCount', fm['loops']), ('boundaryEdgeCount', fm['edgeCount'])]))
    # tessellated faces: one node per triangulated face so a tessellated solid
    # is represented in the graph rather than exported as an empty model.
    for idx, tf in enumerate(tess['faces'] if tess else []):
        pool = (tess['pools'].get(tf.get('coordinatesId')) or []) if tess else []
        nodes.append(OrderedDict([
            ('id', 'TessFace-%d' % idx), ('type', 'Face'),
            ('representation', 'tessellated'), ('stepEntityId', tf['id']),
            ('surfaceType', tf['surfaceType'] or 'UNKNOWN'),
            ('triangleCount', len(tf['triangles'])),
            ('coordinatePoolId', tf.get('coordinatesId')),
            ('coordinateCount', len(pool))]))
    # lightweight Edge nodes only for PMI-referenced topological edges
    pmi_edge_refs = sorted({pe['target'] for pe in pmi_edges if pe['targetType'] == 'Edge'},
                           key=lambda x: int(x[1:]))
    for xid in pmi_edge_refs:
        nodes.append(OrderedDict([('id', 'Edge-%s' % xid[1:]), ('type', 'Edge'),
                                  ('stepEntityId', xid),
                                  ('curveType', edge_info.get(xid, {}).get('curveType'))]))
    for n in sorted(pmi_nodes, key=lambda n: int(n['eid'][1:])):
        if n['kind'] == 'Datum':
            nodes.append(OrderedDict([('id', 'Datum-%s' % n['eid'][1:]), ('type', 'Datum'),
                                      ('stepEntityId', n['eid']), ('label', n['letter'])]))
        elif n['kind'] == 'GeometricTolerance':
            nodes.append(OrderedDict([
                ('id', 'GeoTol-%s' % n['eid'][1:]), ('type', 'GeometricTolerance'),
                ('stepEntityId', n['eid']), ('name', n['name']),
                ('toleranceType', n['toleranceType']),
                ('toleranceValue', n['value']), ('toleranceValueMm', n['valueMm']),
                ('datumReferences', n['datums'])]))
        else:
            nodes.append(OrderedDict([
                ('id', 'Dim-%s' % n['eid'][1:]), ('type', 'Dimension'),
                ('stepEntityId', n['eid']), ('name', n['name']),
                ('nominal', n['nominal']), ('nominalMm', n['nominalMm']),
                ('upper', n['upper']), ('lower', n['lower'])]))
    for d in sorted(drf_nodes, key=lambda d: int(d['eid'][1:])):
        nodes.append(OrderedDict([('id', 'DRF-%s' % d['eid'][1:]), ('type', 'DatumReferenceFrame'),
                                  ('stepEntityId', d['eid']), ('name', d['name']),
                                  ('orderedDatums', d['letters'])]))

    node_id_of = {}
    for n in pmi_nodes:
        node_id_of[n['eid']] = {'Datum': 'Datum-', 'GeometricTolerance': 'GeoTol-', 'Dimension': 'Dim-'}[n['kind']] + n['eid'][1:]

    edges = []
    for k, r in enumerate(adj_records):
        i, j = face_index[r['faces'][0]], face_index[r['faces'][1]]
        d = r['dihedral']
        e = OrderedDict([
            ('id', 'Adj-%d' % k), ('type', 'Adjacency'),
            ('source', 'Face-%d' % i), ('target', 'Face-%d' % j),
            ('sharedEdgeId', r['edgeId']), ('curveType', r['curveType']),
            ('dihedralAngleRad', round(d[0], 6) if d else None),
            ('dihedralAngleDeg', round(math.degrees(d[0]), 6) if d else None),
            ('convexity', d[1] if d else 'unresolved')])
        if not d:
            e['unresolvedReasons'] = r['unresolvedReasons']
        edges.append(e)
    for pe in pmi_edges:
        if pe['targetType'] == 'Face':
            # An annotation may point at a face that is not part of the part's
            # B-Rep (e.g. a SHELL_BASED_SURFACE_MODEL "fill" face, which the
            # exporter deliberately drops). Such a reference has no node to
            # resolve to, so its target is left unset.
            tgt = ('Face-%d' % face_index[pe['target']]) if pe['target'] in face_index else None
        elif pe['targetType'] == 'Edge':
            tgt = 'Edge-%s' % pe['target'][1:]
        else:
            tgt = None
        edges.append(OrderedDict([
            ('id', 'Ref-%d' % len(edges)), ('type', 'PMI-Topology'),
            ('source', node_id_of.get(pe['pmi'])), ('target', tgt),
            ('targetType', pe['targetType'] or 'none'),
            ('resolution', pe['resolution']), ('resolutionReason', pe['resolutionReason'])]))
    # DatumReference: tolerance -> DRF; Component: DRF -> ordered datums
    k = 0
    for n in sorted(pmi_nodes, key=lambda n: int(n['eid'][1:])):
        if n['kind'] != 'GeometricTolerance':
            continue
        for drf in n.get('drfRefs', []):
            edges.append(OrderedDict([
                ('id', 'DatumRef-%d' % k), ('type', 'DatumReference'),
                ('source', node_id_of[n['eid']]), ('target', 'DRF-%s' % drf[1:])]))
            k += 1
    for d in sorted(drf_nodes, key=lambda d: int(d['eid'][1:])):
        for pos, letter in enumerate(d['letters']):
            deid = letter_to_datum.get(letter)
            if deid:
                edges.append(OrderedDict([
                    ('id', 'Comp-%d' % k), ('type', 'Component'),
                    ('source', 'DRF-%s' % d['eid'][1:]), ('target', 'Datum-%s' % deid[1:]),
                    ('order', pos)]))
                k += 1

    # ---- Euler (with geometric vertex merging) ----
    n_faces = len(face_ids)
    n_edges_all = len(edge_info)
    vert_pts = {}
    for eid, info in edge_info.items():
        for v in (info['v1'], info['v2']):
            if v:
                vert_pts[v] = vertex_point(v)
    n_vert_entities = len(vert_pts)
    geo_keys = {tuple(round(c, 6) for c in p) for p in vert_pts.values() if p}
    n_vert_geo = len(geo_keys)
    # Count only the shells that are actually exported (the part's B-Rep), so the
    # summary agrees with ``geometry.shells``; auxiliary SHELL_BASED_SURFACE_MODEL
    # "fill" shells are deliberately not part of the rebuilt solid. When the file
    # declares no part shell at all the exporter falls back to every shell.
    n_shells = sum(1 for eid in order
                   if entities[eid]['type'] in ('CLOSED_SHELL', 'OPEN_SHELL')
                   and eid not in derived_shells
                   and (not part_shells or eid in part_shells))
    n_manifold = sum(1 for i in edge_info.values() if len(i['faces']) == 2)
    n_seam = sum(1 for i in edge_info.values() if len(i['faces']) == 1)
    n_nonmanifold = sum(1 for i in edge_info.values() if len(i['faces']) >= 3)
    euler_entities = n_faces - n_edges_all + n_vert_entities
    euler_geo = n_faces - n_edges_all + n_vert_geo
    genus_geo = n_shells - euler_geo / 2.0
    euler_note = ('genus well-defined' if abs(genus_geo - round(genus_geo)) < 1e-9
                  else 'non-manifold pinch in raw entity complex (odd chi); authoritative sewing requires OCCT')

    # ---- tessellated summary ----
    n_tess_faces = len(tess['faces']) if tess else 0
    n_tess_shells = len(tess['shells']) if tess else 0
    n_tess_tris = sum(len(f['triangles']) for f in tess['faces']) if tess else 0
    n_tess_points = sum(len(pts) for pts in tess['pools'].values()) if tess else 0
    tess_surf_hist = defaultdict(int)
    if tess:
        for f in tess['faces']:
            tess_surf_hist[f['surfaceType'] or 'unknown'] += 1

    # ---- dangling faces: ADVANCED_FACE entities no shell references ----
    referenced_faces = set(face_ids)
    all_faces_set = {eid for eid in order if entities[eid]['type'] in ('ADVANCED_FACE', 'FACE_SURFACE')}
    dangling_face_ids = sorted(all_faces_set - referenced_faces, key=lambda v: int(v[1:]))

    # ---- geometry section: enough raw data to rebuild the B-Rep faithfully ----
    # Full precision is kept here (unlike the rounded graph attributes) so the
    # round trip STEP -> graph -> STEP is byte-stable for reconstruction.
    #
    # A vertex is only meaningful (and only rebuildable) when something
    # references it: an EDGE_CURVE endpoint or a VERTEX_LOOP bound (a cone apex
    # is legitimately referenced only by the latter). Points referenced by
    # neither are *dangling* -- they carry no topology in the B-Rep the graph
    # reconstructs, so they are filtered out here instead of being written into
    # the geometry section and re-emitted as orphan CARTESIAN_POINT / VERTEX_POINT
    # entities by the rebuilder.
    edge_vertex_ids = {v for info in edge_info.values() for v in (info['v1'], info['v2']) if v}
    referenced_vids = edge_vertex_ids | apex_vids
    # every VERTEX_POINT declared in the file that the topology walk never used
    raw_vertex_ids = {eid for eid in order if entities[eid]['type'] == 'VERTEX_POINT'}
    dangling_vids = sorted(raw_vertex_ids - referenced_vids, key=lambda v: int(v[1:]))
    geo_vertices = []
    unreadable_vids = []  # referenced, but no coordinate could be extracted
    for vid in sorted(referenced_vids, key=lambda v: int(v[1:])):
        p = vertex_point(vid)
        if p:
            geo_vertices.append(OrderedDict([('id', vid), ('point', p)]))
        else:
            unreadable_vids.append(vid)

    geo_surfaces = []
    for fid in face_ids:
        sref = face_meta[fid].get('surfaceRef')
        if not sref or any(s['id'] == sref for s in geo_surfaces):
            continue
        sd = get_surface(entities, sref, angle_scale)
        if not sd:
            continue
        rec = OrderedDict([('id', sref), ('type', sd['type'])])
        # placement is flattened for the analytic surfaces; freeform / swept
        # surfaces keep every defining field returned by get_surface.
        pl = sd.get('placement')
        if pl:
            rec['origin'], rec['axis'], rec['xAxis'] = pl[0], pl[1], pl[2]
        for k, v in sd.items():
            if k in ('type', 'placement') or v is None:
                continue
            rec[k] = v
        geo_surfaces.append(rec)

    geo_curves = []
    for eid in sorted(edge_info, key=lambda v: int(v[1:])):
        cref = edge_info[eid].get('curveId')
        if not cref or any(c['id'] == cref for c in geo_curves):
            continue
        cd = get_curve(entities, cref)
        if not cd:
            continue
        rec = OrderedDict([('id', cref)])
        rec.update(cd)
        geo_curves.append(rec)

    geo_edges = []
    for eid in sorted(edge_info, key=lambda v: int(v[1:])):
        info = edge_info[eid]
        geo_edges.append(OrderedDict([
            ('id', eid), ('vertices', [info['v1'], info['v2']]),
            ('curve', info['curveId']), ('sameSense', info['sameSense'])]))

    geo_faces = []
    for fid in face_ids:
        meta = face_meta[fid]
        brecs = []
        for b in meta['bounds']:
            br = OrderedDict([('outer', b['outer']), ('orientation', b['orientation'])])
            if b.get('vertexLoop'):
                br['vertexLoop'] = True
                br['vertexLoopVtx'] = b.get('vertexLoopVtx')
            else:
                br['edges'] = [[e, o] for e, o in b['edges']]
            brecs.append(br)
        geo_faces.append(OrderedDict([
            ('id', fid), ('surface', meta.get('surfaceRef')),
            ('sameSense', meta['sameSense']), ('bounds', brecs)]))

    geo_shells = []
    for eid in order:
        e = entities[eid]
        if e['type'] not in ('CLOSED_SHELL', 'OPEN_SHELL'):
            continue
        if eid in derived_shells:
            continue
        if part_shells and eid not in part_shells:
            continue
        fids = [r for r in e['refs']
                if entities.get(r, {}).get('type') in ('ADVANCED_FACE', 'FACE_SURFACE')]
        geo_shells.append(OrderedDict([
            ('id', eid), ('closed', e['type'] == 'CLOSED_SHELL'), ('faces', fids)]))

    geometry = OrderedDict([
        ('note', 'raw B-Rep data for faithful reconstruction; full precision, no rounding'),
        ('vertices', geo_vertices), ('edges', geo_edges), ('curves', geo_curves),
        ('surfaces', geo_surfaces), ('faces', geo_faces), ('shells', geo_shells),
    ])
    # ---- tessellated geometry block (present only when a tessellated solid
    #      exists): the exact triangulation the file defines, so a tessellated
    #      part is reconstructed rather than silently dropped. ----
    if tess:
        # supporting surfaces of the triangulated faces, so the rebuild can
        # emit COMPLEX_TRIANGULATED_FACE with its true surface reference.
        for tf in tess['faces']:
            sref = tf.get('surfaceRef')
            if not sref or any(s['id'] == sref for s in geo_surfaces):
                continue
            sd = get_surface(entities, sref, angle_scale)
            if not sd:
                continue
            rec = OrderedDict([('id', sref), ('type', sd['type'])])
            pl = sd.get('placement')
            if pl:
                rec['origin'], rec['axis'], rec['xAxis'] = pl[0], pl[1], pl[2]
            for k, v in sd.items():
                if k in ('type', 'placement') or v is None:
                    continue
                rec[k] = v
            geo_surfaces.append(rec)
        geo_tess_faces = []
        for f in tess['faces']:
            geo_tess_faces.append(OrderedDict([
                ('id', f['id']),
                ('kind', f['kind']),
                ('surface', f['surfaceRef']),
                ('surfaceType', f['surfaceType']),
                ('coordinates', f['coordinatesId']),
                ('pnmax', f['pnmax']),
                ('normals', f['normals']),
                ('pnindex', f['pnindex']),
                ('triangleStrips', f['triangleStrips']),
                ('triangleFans', f['triangleFans']),
                ('triangles', f['triangles']),
            ]))
        geo_tess_pools = [OrderedDict([('id', pid), ('points', pts)])
                          for pid, pts in sorted(tess['pools'].items(), key=lambda kv: int(kv[0][1:]))]
        geo_tess_shells = [OrderedDict([('id', sh['id']), ('name', sh['name']),
                                        ('items', sh['items']), ('faces', sh['faces'])])
                           for sh in tess['shells']]
        geo_tess_solids = [OrderedDict([('id', s['id']), ('name', s['name']),
                                        ('items', s['items']), ('faces', s['faces'])])
                           for s in tess['solids']]
        geometry['representation'] = representation
        geometry['tessellated'] = OrderedDict([
            ('note', 'triangulated faces (shared COORDINATES_LIST pools + 1-based '
                     'triangle indices); the tessellated B-Rep the file defines'),
            ('solids', geo_tess_solids), ('shells', geo_tess_shells),
            ('coordinatePools', geo_tess_pools),
            ('faces', geo_tess_faces),
        ])
    else:
        geometry['representation'] = representation

    conv_hist = defaultdict(int)
    for r in adj_records:
        conv_hist[r['dihedral'][1] if r['dihedral'] else 'unresolved'] += 1
    surf_hist = defaultdict(int)
    for fid in face_ids:
        surf_hist[face_meta[fid]['surface']['type'] if face_meta[fid]['surface'] else 'unknown'] += 1
    curve_hist = defaultdict(int)
    for r in adj_records:
        curve_hist[r['curveType'] or 'unknown'] += 1

    n_faces_pairs = len({(min(r['faces']), max(r['faces'])) for r in adj_records})

    # adjacency matrices
    A = [[0] * n_faces for _ in range(n_faces)]
    W = [[0] * n_faces for _ in range(n_faces)]
    for r in adj_records:
        i, j = face_index[r['faces'][0]], face_index[r['faces'][1]]
        A[i][j] = A[j][i] = 1
        W[i][j] += 1
        if i != j:
            W[j][i] += 1

    graph = OrderedDict([
        ('graphVersion', 2),
        ('source', OrderedDict([('file', os.path.basename(src)), ('schema', schema),
                                ('lengthUnit', unit_name), ('scaleToMillimeters', scale_mm),
                                ('generator', 'step_graph_export.py (STEP round-trip toolchain)')])),
        ('summary', OrderedDict([
            ('representation', representation),
            ('faceCount', n_faces), ('topologicalEdgeCount', n_edges_all),
            ('vertexEntityCount', n_vert_entities), ('geometricVertexCount', n_vert_geo),
            ('danglingVertexCount', len(dangling_vids)),
            ('danglingFaceCount', len(dangling_face_ids)),
            ('loopCount', loop_count_total), ('shellCount', n_shells),
            ('tessellatedFaceCount', n_tess_faces),
            ('tessellatedShellCount', n_tess_shells),
            ('tessellatedTriangleCount', n_tess_tris),
            ('tessellatedCoordinateCount', n_tess_points),
            ('tessellatedSurfaceTypeHistogram', dict(tess_surf_hist)),
            ('manifoldEdgeCount', n_manifold), ('seamEdgeCount', n_seam),
            ('nonManifoldEdgeCount', n_nonmanifold),
            ('adjacencyEdgeCount', len(adj_records)), ('adjacentFacePairCount', n_faces_pairs),
            ('pmiNodeCount', len(pmi_nodes)), ('pmiEdgeResolved', pmi_res['resolved']),
            ('pmiEdgeMissing', pmi_res['missing']),
            ('convexityHistogram', dict(conv_hist)),
            ('surfaceTypeHistogram', dict(surf_hist)),
            ('sharedEdgeCurveTypeHistogram', dict(curve_hist)),
            ('eulerPoincare', OrderedDict([
                ('F', n_faces), ('E', n_edges_all), ('VGeometric', n_vert_geo),
                ('VminusEplusF', euler_geo), ('shells', n_shells),
                ('computedGenus', round(genus_geo, 6)),
                ('note', euler_note)])),
        ])),
        ('nodes', nodes), ('edges', edges),
        ('geometry', geometry)])

    base = os.path.splitext(os.path.basename(src))[0]
    json_path = os.path.join(out_dir, base + '.graph.json')
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)
    csv_path = os.path.join(out_dir, base + '.face-adjacency-matrix.csv')
    with open(csv_path, 'w', encoding='utf-8') as f:
        f.write(',' + ','.join(str(j) for j in range(n_faces)) + '\n')
        for i in range(n_faces):
            f.write(str(i) + ',' + ','.join(str(v) for v in A[i]) + '\n')
    wcsv_path = os.path.join(out_dir, base + '.face-adjacency-weighted.csv')
    with open(wcsv_path, 'w', encoding='utf-8') as f:
        f.write(',' + ','.join(str(j) for j in range(n_faces)) + '\n')
        for i in range(n_faces):
            f.write(str(i) + ',' + ','.join(str(v) for v in W[i]) + '\n')

    # ---- console summary ----
    print('file: %s' % os.path.basename(src))
    print('schema: %s' % schema)
    print('units: %s (scale to mm: %g)' % (unit_name, scale_mm))
    print('representation: %s' % representation)
    print('faces=%d topological-edges=%d vertices(entities)=%d vertices(geometric)=%d loops=%d shells=%d'
          % (n_faces, n_edges_all, n_vert_entities, n_vert_geo, loop_count_total, n_shells))
    if tess:
        print('tessellated: faces=%d shells=%d triangles=%d coordinates=%d  surfaces=%s'
              % (n_tess_faces, n_tess_shells, n_tess_tris, n_tess_points, dict(tess_surf_hist)))
    if dangling_vids:
        print('dangling vertices filtered (referenced by no edge and no vertex loop): %d %s'
              % (len(dangling_vids), dangling_vids[:8]))
    if dangling_face_ids:
        print('dangling faces filtered (referenced by no shell): %d %s'
              % (len(dangling_face_ids), dangling_face_ids[:8]))
    if representation in ('tessellated', 'mixed') and n_faces == 0 and n_tess_faces == 0:
        print('WARNING: file declares a solid but no face geometry could be read')
    if unreadable_vids:
        print('referenced vertices with no extractable point (kept out of geometry): %d %s'
              % (len(unreadable_vids), unreadable_vids[:8]))
    print('edge incidence: manifold=%d seam=%d non-manifold=%d' % (n_manifold, n_seam, n_nonmanifold))
    print('Euler-Poincare (geometric vertices): F-E+V = %d -> genus = %g  [%s]' % (euler_geo, genus_geo, euler_note))
    print('surface types: %s' % dict(surf_hist))
    print('adjacency graph edges: %d (between %d face pairs)' % (len(adj_records), n_faces_pairs))
    print('shared-edge curve types: %s' % dict(curve_hist))
    print('convexity: %s' % dict(conv_hist))
    print('PMI nodes: %d (datums=%d tolerances=%d dimensions=%d DRFs=%d)' % (
        len(pmi_nodes),
        sum(1 for n in pmi_nodes if n['kind'] == 'Datum'),
        sum(1 for n in pmi_nodes if n['kind'] == 'GeometricTolerance'),
        sum(1 for n in pmi_nodes if n['kind'] == 'Dimension'), len(drf_nodes)))
    print('PMI->topology edges resolved/missing: %d/%d' % (pmi_res['resolved'], pmi_res['missing']))
    print()
    print('PMI resolution detail:')
    for pe in pmi_edges:
        if pe['resolution'] == 'missing':
            print('  MISSING %s (%s): %s' % (pe['pmi'], node_id_of.get(pe['pmi']), pe['resolutionReason']))
    for pe in pmi_edges:
        if pe['resolution'] == 'resolved':
            if pe['targetType'] == 'Face':
                if pe['target'] not in face_index:
                    continue
                tgt = 'Face-%d' % face_index[pe['target']]
            else:
                tgt = 'Edge-%s' % pe['target'][1:]
            print('  RESOLVED %s (%s) -> %s' % (pe['pmi'], node_id_of.get(pe['pmi']), tgt))
    print()
    print('sample PMI nodes:')
    for n in sorted(pmi_nodes, key=lambda n: int(n['eid'][1:])):
        if n['kind'] == 'GeometricTolerance':
            print('  %s %s(%r) value=%s datums=%s' % (n['eid'], n['toleranceType'], n['name'], n['value'], n['datums']))
        elif n['kind'] == 'Dimension':
            print('  %s dim(%r) nominal=%s upper=%s lower=%s' % (n['eid'], n['name'], n['nominal'], n['upper'], n['lower']))
        else:
            print('  %s datum(%s)' % (n['eid'], n['letter']))
    print()
    print('sample adjacency edges:')
    for r in adj_records[:6]:
        i, j = face_index[r['faces'][0]], face_index[r['faces'][1]]
        d = r['dihedral']
        print('  Face-%d -- Face-%d edge=%s curve=%s dihedral=%s convexity=%s' % (
            i, j, r['edgeId'], r['curveType'],
            ('%.3f deg' % math.degrees(d[0])) if d else 'n/a', d[1] if d else 'unresolved'))
    print()
    prev = min(10, n_faces)
    print('adjacency matrix preview (first %dx%d of %dx%d):' % (prev, prev, n_faces, n_faces))
    print('      ' + ' '.join('%2d' % j for j in range(prev)))
    for i in range(prev):
        print('F%-4d ' % i + ' '.join('%2d' % v for v in A[i][:prev]))
    print()
    print('outputs:')
    for p in (json_path, csv_path, wcsv_path):
        print(' ', p)
    return {'graph': json_path, 'matrix': csv_path,
            'weighted': wcsv_path, 'data': graph}


def _cli(argv=None):
    import argparse
    ap = argparse.ArgumentParser(
        prog='step_graph_export.py',
        description='Export a STEP (ISO-10303-21) B-rep to a JSON graph with '
                    'geometry, PMI and face-adjacency matrices.')
    ap.add_argument('step', help='input .stp/.step file')
    ap.add_argument('-o', '--out-dir', default=None,
                    help='output directory (default: next to the input file)')
    a = ap.parse_args(argv)
    if not os.path.isfile(a.step):
        ap.error('no such file: %s' % a.step)
    main(a.step, a.out_dir)
    return 0


if __name__ == '__main__':
    raise SystemExit(_cli())
