"""Rebuild an ISO-10303-21 (STEP) file from a graph export produced by
step_graph_export.py (schema v2, i.e. one that carries the `geometry` section).

This is the inverse of the exporter: STEP -> graph JSON -> STEP'. The rebuilt
file is a fresh AP242 file with:

  * the same B-Rep topology (faces / edges / vertices / loops, with all the
    orientation flags preserved),
  * the same geometry (points, axes, radii, semi-angles, B-spline control
    points + knots),
  * the same semantic PMI (datums, datum systems / reference frames, geometric
    tolerances with their values and datum references, dimensional sizes with
    nominal / upper / lower values, and the shape-aspect + GISU chain linking
    each item to the faces it applies to).

Entity numbering is regenerated from scratch (the original ids are not reused),
and no reference is left dangling. Feeding the rebuilt file back through
``step_graph_export.py`` yields the same graph (same face/edge/curve/surface
signatures, vertex set, adjacency matrix and PMI) unless something is reported
as neglected.

CLI:
    python step_graph_rebuild.py part.graph.json [out.rebuilt.stp] [--preserve-ids]

Design notes
------------
* Points and directions are deduplicated through memo tables, mirroring what a
  typical CAD translator emits.
* Only information present in the graph is written. Where the original source
  had something the exporter deliberately does not model (e.g. presentation /
  annotation geometry, or PMI items with no topology link), the rebuilt file
  simply omits it rather than inventing a placeholder -- the rebuild is faithful
  to the *graph*, which is the contract here.
* Units are taken from the graph's `source.lengthUnit`; mm is written as the
  SI_UNIT(.MILLI.,.METRE.) complex used by the example file.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)      # so `import step_graph_export` works from any cwd

SCHEMA = 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'

# Set by rebuild(); lets callers read the "neglected feature" record.
_last_rebuilder = None

# toleranceType (graph) -> STEP entity name
TOL_ENTITY = {
    'position': 'POSITION_TOLERANCE',
    'profile of surface': 'PROFILE_OF_SURFACE_TOLERANCE',
    'profile of line': 'PROFILE_OF_LINE_TOLERANCE',
    'flatness': 'FLATNESS_TOLERANCE',
    'straightness': 'STRAIGHTNESS_TOLERANCE',
    'circularity': 'ROUNDNESS_TOLERANCE',
    'roundness': 'ROUNDNESS_TOLERANCE',
    'cylindricity': 'CYLINDRICITY_TOLERANCE',
    'parallelism': 'PARALLELISM_TOLERANCE',
    'perpendicularity': 'PERPENDICULARITY_TOLERANCE',
    'angularity': 'ANGULARITY_TOLERANCE',
    'coaxiality': 'COAXIALITY_TOLERANCE',
    'concentricity': 'CONCENTRICITY_TOLERANCE',
    'symmetry': 'SYMMETRY_TOLERANCE',
    'circular runout': 'CIRCULAR_RUNOUT_TOLERANCE',
    'total runout': 'TOTAL_RUNOUT_TOLERANCE',
    'line profile': 'PROFILE_OF_LINE_TOLERANCE',
}


def fmt(x):
    """Format a real for STEP (ISO-10303-21): a decimal point is required and
    the ``E`` exponent form is NOT permitted.

    ``repr`` switches to exponent notation for very small / very large floats
    (e.g. a coordinate of ``1.38777878078145e-13``), which some readers -- OCCT
    included -- reject as a syntax error. Expand any such value into a plain
    decimal real instead so the rebuilt file is always valid STEP.
    """
    if x is None:
        return '$'
    x = float(x)
    if x == 0:
        return '0.'
    s = repr(x)
    if 'e' in s or 'E' in s:
        # Expand the exponent form into a fixed-point decimal (no 'E').
        # Decimal handles the scaling exactly for the digits carried by repr.
        from decimal import Decimal
        d = Decimal(s)
        s = format(d, 'f')
    if '.' not in s:
        s += '.'
    return s


def flist(vals):
    return '(' + ','.join(fmt(v) for v in vals) + ')'


def _step_string(value):
    """Render a STEP string literal, doubling any embedded apostrophe."""
    return "'" + str(value).replace("'", "''") + "'"


def _expand_triangles(strips, fans):
    """Expand tessellated triangle strips / fans into explicit triangles."""
    out = []
    for strip in strips or []:
        for k in range(len(strip) - 2):
            if k % 2 == 0:
                out.append([strip[k], strip[k + 1], strip[k + 2]])
            else:
                out.append([strip[k + 1], strip[k], strip[k + 2]])
    for fan in fans or []:
        for i in range(1, len(fan) - 1):
            out.append([fan[0], fan[i], fan[i + 1]])
    return out


def _perp(n):
    """A unit vector perpendicular to ``n``, chosen deterministically.

    Used as the x-axis of the PLANE behind a faceted (triangle) face. Deriving
    it from the normal alone lets triangles that share a normal also share the
    DIRECTION entities, which keeps the faceted solid compact.
    """
    a = [0.0, 0.0, 0.0]
    a[min(range(3), key=lambda i: abs(n[i]))] = 1.0
    x = [a[1] * n[2] - a[2] * n[1],
         a[2] * n[0] - a[0] * n[2],
         a[0] * n[1] - a[1] * n[0]]
    length = math.sqrt(sum(c * c for c in x))
    if length == 0:
        return (1.0, 0.0, 0.0)
    return tuple(c / length for c in x)


def _pkey(p):
    """Round a point so identical mesh vertices get identical STEP entities.

    Tessellation pools repeat the same corner with tiny differences (and the
    same corner appears in several faces). Rounding to 1e-6 mm makes the B-rep
    faces share their boundary points exactly; the tessellated representation is
    written from the untouched pools, so no precision is lost there.
    """
    return tuple(round(float(c), 6) for c in p)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _unit(v):
    length = math.sqrt(sum(c * c for c in v))
    if not length:
        return None
    return tuple(c / length for c in v)


def _face_normal(triangles):
    """Area-weighted outward normal of a consistently wound triangle patch."""
    n = [0.0, 0.0, 0.0]
    for p0, p1, p2 in triangles:
        u = [float(p1[i]) - float(p0[i]) for i in range(3)]
        v = [float(p2[i]) - float(p0[i]) for i in range(3)]
        c = _cross(u, v)
        for i in range(3):
            n[i] += c[i]
    return _unit(n)


def _boundary_loops(triangles):
    """Chain the border of a consistently wound triangle patch into loops.

    An edge is a border edge when it is walked more often in one direction than
    the other; the excess multiplicity becomes that many border edges, which
    keeps non-manifold seams from swallowing a face boundary. The loops are
    returned in the triangles' winding, so a patch wound outward yields
    counter-clockwise outer loops and clockwise hole loops -- exactly the
    orientation STEP expects for ``FACE_OUTER_BOUND`` / ``FACE_BOUND``.

    Returns [] when the border cannot be chained into closed loops.
    """
    directed = {}
    for tri in triangles:
        p0, p1, p2 = (_pkey(p) for p in tri)
        if p0 == p1 or p1 == p2 or p2 == p0:
            continue
        for e in ((p0, p1), (p1, p2), (p2, p0)):
            directed[e] = directed.get(e, 0) + 1
    border = {}
    for (p, q), n in directed.items():
        extra = n - directed.get((q, p), 0)
        if extra > 0:
            border[(p, q)] = extra
    if not border:
        return []

    out = {}
    for (p, q), n in border.items():
        out.setdefault(p, []).extend([q] * n)

    loops = []
    while out:
        start = next(iter(out))
        loop = [start]
        cur = start
        while True:
            nxt = out.get(cur)
            if not nxt:
                # dead end: the border is not a closed loop
                return []
            q = nxt.pop(0)
            if not nxt:
                del out[cur]
            if q == start:
                break
            if q in loop:
                # re-entered the same vertex: degenerate loop
                return []
            loop.append(q)
            cur = q
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def _surface_normal(sd, p):
    """Unit surface normal at ``p`` in the surface's own parameterisation.

    Returns None when the surface type has no local normal here; the caller
    then leaves the face orientation at ``.T.``.
    """
    t = sd.get('type')
    if t == 'PLANE':
        return _unit(sd.get('axis') or (0.0, 0.0, 0.0))
    if t in ('CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SPHERICAL_SURFACE'):
        o = sd.get('origin')
        if not o:
            return None
        d = [float(p[i]) - float(o[i]) for i in range(3)]
        if t == 'SPHERICAL_SURFACE':
            return _unit(d)
        a = _unit(sd.get('axis') or (0.0, 0.0, 0.0))
        if not a:
            return None
        h = sum(d[i] * a[i] for i in range(3))
        radial = _unit([d[i] - h * a[i] for i in range(3)])
        if not radial:
            return None
        if t == 'CYLINDRICAL_SURFACE':
            return radial
        # cone: the normal tilts away from the radial direction by the semi-angle
        ang = float(sd.get('semiAngleRad') or 0.0)
        n = [radial[i] * math.cos(ang) - a[i] * math.sin(ang) for i in range(3)]
        return _unit(n)
    if t in ('B_SPLINE_SURFACE_WITH_KNOTS', 'B_SPLINE_SURFACE',
             'RATIONAL_B_SPLINE_SURFACE'):
        try:
            import step_graph_export as _export
            uv = _export._closest_uv_on_bspline(sd, p)
            if not uv:
                return None
            ev = _export._bspline_surface_eval(sd, uv[0], uv[1])
        except Exception:
            return None
        if not ev:
            return None
        _point, du, dv = ev
        return _unit(_cross(du, dv))
    return None


def _same_sense(sd, loop, normal):
    """``same_sense`` flag for a face on ``sd`` whose outward normal is ``normal``."""
    c = tuple(sum(float(p[i]) for p in loop) / len(loop) for i in range(3))
    sn = _surface_normal(sd, c)
    if not sn:
        return '.T.'
    return '.T.' if sum(sn[i] * normal[i] for i in range(3)) >= 0 else '.F.'


def logical(v):
    """Render a STEP ``LOGICAL`` flag as ``.T.`` / ``.F.`` / ``.U.``.

    The graph stores the tri-state token (``'T'``/``'F'``/``'U'``) so that an
    unknown (``.U.``) assertion is not silently downgraded to ``.F.`` -- doing
    so is not a no-op and can make a reader reject or mis-sew B-spline
    faces. Older graph exports stored a plain boolean; they are still
    accepted for backwards compatibility.
    """
    if v is True:
        return '.T.'
    if v is False or v is None:
        return '.F.'
    t = str(v).strip().upper()
    if t in ('T', '.T.', 'TRUE'):
        return '.T.'
    if t in ('F', '.F.', 'FALSE'):
        return '.F.'
    return '.U.'


class Writer:
    """Accumulates numbered entities; supports the complex-entity form.

    In ``preserve_ids`` mode, ``add(..., at_id=N)`` places an entity at original
    STEP number ``N`` (so the B-Rep core keeps the source numbering), while all
    synthesized helper entities are allocated fresh numbers that never collide
    with a preserved id. Insertion order (dependency order) is a valid STEP
    ordering, so entity numbers need not be contiguous or ascending.
    """

    def __init__(self, preserve_ids=False):
        self.lines = []
        self._n = 0
        self.preserve_ids = preserve_ids
        self.used = set()          # ids already issued (preserved or allocated)
        self.preserved = set()     # ids reserved for original entities

    def reserve(self, eid):
        """Reserve an original STEP id so synthesized helpers skip it."""
        if eid is None:
            return
        try:
            n = int(eid)
        except (TypeError, ValueError):
            return
        if n > 0:
            self.preserved.add(n)

    def _next_free(self):
        n = self._n + 1
        while n in self.used:
            n += 1
        self._n = n
        self.used.add(n)
        return n

    def _emit(self, eid, body):
        ref = '#%d' % eid
        self.lines.append('%s=%s;' % (ref, body))
        return ref

    def add(self, text, at_id=None):
        if at_id is None:
            return self._emit(self._next_free(), text)
        n = int(at_id)
        if self.preserve_ids and n > 0 and n not in self.used:
            self.used.add(n)
            self._n = max(self._n, n)
            return self._emit(n, text)
        return self._emit(self._next_free(), text)

    def add_complex(self, components, at_id=None):
        # ISO-10303-21 complex entities are wrapped in an extra pair of
        # parentheses:  #N=(COMPONENT1(...) COMPONENT2(...) ...);
        # Omitting the outer parens is invalid syntax (OCCT: "Incorrect Syntax").
        body = '(\n' + '\n'.join('%s(%s)' % (n, a) for n, a in components) + '\n)'
        if at_id is None:
            n = self._next_free()
        else:
            n = int(at_id)
            if not (self.preserve_ids and n > 0 and n not in self.used):
                n = self._next_free()
        if self.preserve_ids:
            self.used.add(n)
            self._n = max(self._n, n)
        return self._emit(n, body)


class UnsupportedGeometry(Exception):
    """Raised when the graph carries geometry the rebuilder cannot reproduce.

    The caller (``face``/``edge``) catches this and *neglects* the affected
    entity instead of inventing a placeholder, keeping the rebuild faithful to
    the subset of the graph it can represent.
    """


class Rebuilder:
    def __init__(self, graph, preserve_ids=False):
        self.g = graph
        self.geo = graph['geometry']
        self.preserve_ids = preserve_ids
        self.w = Writer(preserve_ids)
        # memo tables
        self._points = {}
        self._dirs = {}
        self._placements = {}
        self._vectors = {}
        self._vertices = {}
        self._curves = {}
        self._surfaces = {}
        self._faces = {}
        self._edges = {}
        # step id -> rebuilt ref (for PMI target lookup)
        self.face_ref = {}
        self.edge_ref = {}
        # "failed feature" bookkeeping: geometry the graph carries but the
        # rebuilder cannot faithfully reproduce (non-analytic surfaces/curves).
        # These are *neglected* rather than guessed: the face/edge is dropped and
        # recorded so the caller can report the reconstructed subset.
        self.skipped = {'surfaces': [], 'curves': [], 'edges': [], 'faces': [],
                        'reasons': {}}
        # MANIFOLD_SOLID_BREPs written from the tessellation (see
        # _build_faceted_solids); empty when the graph carries no tessellation.
        self._faceted_solids = []
        # shared VERTEX_POINTs for the tessellation's boundary edges
        self._tess_vertices = {}

    # ------------------------------------------------------------ primitives
    def point(self, p):
        key = tuple(round(float(c), 12) for c in p)
        if key in self._points:
            return self._points[key]
        ref = self.w.add("CARTESIAN_POINT('',(%s))" % ','.join(fmt(c) for c in p))
        self._points[key] = ref
        return ref

    def direction(self, d):
        key = tuple(round(float(c), 12) for c in d)
        if key in self._dirs:
            return self._dirs[key]
        ref = self.w.add("DIRECTION('',(%s))" % ','.join(fmt(c) for c in d))
        self._dirs[key] = ref
        return ref

    def placement(self, origin, axis, xaxis):
        key = (tuple(round(float(c), 12) for c in origin),
               tuple(round(float(c), 12) for c in axis),
               tuple(round(float(c), 12) for c in xaxis))
        if key in self._placements:
            return self._placements[key]
        ref = self.w.add("AXIS2_PLACEMENT_3D('',%s,%s,%s)"
                         % (self.point(origin), self.direction(axis), self.direction(xaxis)))
        self._placements[key] = ref
        return ref

    def vector(self, d, magnitude):
        key = (tuple(round(float(c), 12) for c in d), round(float(magnitude), 12))
        if key in self._vectors:
            return self._vectors[key]
        ref = self.w.add("VECTOR('',%s,%s)" % (self.direction(d), fmt(magnitude)))
        self._vectors[key] = ref
        return ref

    # ------------------------------------------------------------ geometry
    def vertex(self, vid):
        if vid in self._vertices:
            return self._vertices[vid]
        gv = self.vmap.get(vid)
        if gv is None:
            raise UnsupportedGeometry('edge references unknown vertex %s' % vid)
        ref = self.w.add("VERTEX_POINT('',%s)" % self.point(gv),
                         at_id=int(vid[1:]) if self.preserve_ids else None)
        self._vertices[vid] = ref
        return ref

    def curve(self, cid):
        if cid in self._curves:
            return self._curves[cid]
        cd = self.cmap.get(cid)
        if cd is None:
            raise UnsupportedGeometry('edge references unknown curve %s' % cid)
        t = cd['type']
        if cd.get('unsupported'):
            raise UnsupportedGeometry('unsupported curve type %s (%s) -- cannot rebuild' % (t, cid))
        if t not in ('LINE', 'CIRCLE', 'ELLIPSE', 'B_SPLINE_CURVE_WITH_KNOTS'):
            raise UnsupportedGeometry('unsupported curve type %s (%s)' % (t, cid))
        if t == 'LINE' and ('point' not in cd or 'direction' not in cd):
            raise UnsupportedGeometry('LINE (%s) missing point/direction' % cid)
        if t in ('CIRCLE', 'ELLIPSE') and not cd.get('placement'):
            raise UnsupportedGeometry('%s (%s) missing placement' % (t, cid))
        if t == 'B_SPLINE_CURVE_WITH_KNOTS' and 'controlPoints' not in cd:
            raise UnsupportedGeometry('B_SPLINE_CURVE_WITH_KNOTS (%s) missing controlPoints' % cid)
        at = int(cid[1:]) if self.preserve_ids else None
        if t == 'LINE':
            vec = self.vector(cd['direction'], cd.get('magnitude', 1.0))
            ref = self.w.add("LINE('',%s,%s)" % (self.point(cd['point']), vec), at_id=at)
        elif t in ('CIRCLE', 'ELLIPSE'):
            o, ax, xa = cd['placement']
            pl = self.placement(o, ax, xa)
            if t == 'CIRCLE':
                ref = self.w.add("CIRCLE('',%s,%s)" % (pl, fmt(cd['radius'])), at_id=at)
            else:
                ref = self.w.add("ELLIPSE('',%s,%s,%s)"
                                 % (pl, fmt(cd['radius']), fmt(cd['semiAxis2'])), at_id=at)
        elif t == 'B_SPLINE_CURVE_WITH_KNOTS':
            cps = [self.point(p) for p in cd['controlPoints']]
            form = '.%s.' % cd.get('form', 'UNSPECIFIED')
            closed = logical(cd.get('closed'))
            selfint = logical(cd.get('selfIntersect'))
            mults = '(' + ','.join(str(m) for m in cd['knotMultiplicities']) + ')'
            knots = flist(cd['knots'])
            spec = '.%s.' % cd.get('knotSpec', 'UNSPECIFIED')
            weights = cd.get('weights')
            if weights:
                comps = [
                    ('BOUNDED_CURVE', ''),
                    ('B_SPLINE_CURVE',
                     "%d,(%s),%s,%s,%s" % (cd['degree'], ','.join(cps), form, closed, selfint)),
                    ('B_SPLINE_CURVE_WITH_KNOTS', '%s,%s,%s' % (mults, knots, spec)),
                    ('CURVE', ''),
                    ('GEOMETRIC_REPRESENTATION_ITEM', ''),
                    ('RATIONAL_B_SPLINE_CURVE', flist(weights)),
                    ('REPRESENTATION_ITEM', "''"),
                ]
                ref = self.w.add_complex(comps, at_id=at)
            else:
                ref = self.w.add("B_SPLINE_CURVE_WITH_KNOTS('',%d,(%s),%s,%s,%s,%s,%s,%s)"
                                 % (cd['degree'], ','.join(cps), form, closed, selfint,
                                    mults, knots, spec), at_id=at)
        else:
            raise UnsupportedGeometry('unsupported curve type %s (%s)' % (t, cid))
        self._curves[cid] = ref
        return ref

    def surface(self, sid):
        if sid in self._surfaces:
            return self._surfaces[sid]
        sd = self.smap.get(sid)
        if sd is None:
            raise UnsupportedGeometry('face references unknown surface %s' % sid)
        t = sd['type']
        analytic = ('PLANE', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE',
                    'SPHERICAL_SURFACE', 'TOROIDAL_SURFACE')
        if t not in analytic and t not in ('B_SPLINE_SURFACE_WITH_KNOTS', 'B_SPLINE_SURFACE',
                                           'RATIONAL_B_SPLINE_SURFACE'):
            raise UnsupportedGeometry('unsupported surface type %s (%s)' % (t, sid))
        at = int(sid[1:]) if self.preserve_ids else None

        # ---- freeform B-spline surfaces ----
        if t in ('B_SPLINE_SURFACE_WITH_KNOTS', 'B_SPLINE_SURFACE', 'RATIONAL_B_SPLINE_SURFACE'):
            grid = sd.get('controlPoints')
            if not grid or any(any(p is None for p in row) for row in grid):
                raise UnsupportedGeometry('B-spline surface %s missing control points' % sid)
            pts_rows = [','.join(self.point(p) for p in row) for row in grid]
            pts = '(%s)' % ','.join('(%s)' % row for row in pts_rows)
            uDeg, vDeg = sd.get('uDegree'), sd.get('vDegree')
            if uDeg is None or vDeg is None:
                raise UnsupportedGeometry('B-spline surface %s missing degrees' % sid)
            uClosed = logical(sd.get('uClosed'))
            vClosed = logical(sd.get('vClosed'))
            selfint = logical(sd.get('selfIntersect'))
            form = '.%s.' % (sd.get('form') or 'UNSPECIFIED')
            uMults = '(' + ','.join(str(m) for m in sd.get('uMultiplicities', [])) + ')'
            vMults = '(' + ','.join(str(m) for m in sd.get('vMultiplicities', [])) + ')'
            uKnots = flist(sd.get('uKnots', []))
            vKnots = flist(sd.get('vKnots', []))
            spec = '.%s.' % sd.get('knotSpec', 'UNSPECIFIED')
            weights = sd.get('weights')
            if weights:
                wrows = [','.join(fmt(w) for w in row) for row in weights]
                wgrid = '(%s)' % ','.join('(%s)' % row for row in wrows)
                comps = [
                    ('BOUNDED_SURFACE', ''),
                    ('B_SPLINE_SURFACE',
                     "%d,%d,%s,%s,%s,%s,%s" % (uDeg, vDeg, pts, form, uClosed, vClosed,
                                                selfint)),
                    ('B_SPLINE_SURFACE_WITH_KNOTS',
                     '%s,%s,%s,%s,%s' % (uMults, vMults, uKnots, vKnots, spec)),
                    ('GEOMETRIC_REPRESENTATION_ITEM', ''),
                    ('RATIONAL_B_SPLINE_SURFACE', wgrid),
                    # A complex instance must still be a valid subtype of the
                    # entity it replaces: without the SURFACE / REPRESENTATION_ITEM
                    # markers the reader does not recognise the instance as a
                    # surface at all and silently drops the face.
                    ('REPRESENTATION_ITEM', "''"),
                    ('SURFACE', ''),
                ]
                ref = self.w.add_complex(comps, at_id=at)
            else:
                ref = self.w.add(
                    "B_SPLINE_SURFACE_WITH_KNOTS('',%d,%d,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                    % (uDeg, vDeg, pts, form, uClosed, vClosed, selfint,
                       uMults, vMults, uKnots, vKnots, spec), at_id=at)
            self._surfaces[sid] = ref
            return ref

        # ---- analytic surfaces ----
        if 'origin' not in sd or 'axis' not in sd or 'xAxis' not in sd:
            raise UnsupportedGeometry('surface %s (%s) has no placement' % (t, sid))
        pl = self.placement(sd['origin'], sd['axis'], sd['xAxis'])
        if t == 'PLANE':
            ref = self.w.add("PLANE('',%s)" % pl, at_id=at)
        elif t == 'CYLINDRICAL_SURFACE':
            ref = self.w.add("CYLINDRICAL_SURFACE('',%s,%s)" % (pl, fmt(sd['radius'])), at_id=at)
        elif t == 'CONICAL_SURFACE':
            ref = self.w.add("CONICAL_SURFACE('',%s,%s,%s)"
                             % (pl, fmt(sd['radius']), fmt(sd['semiAngleRad'])), at_id=at)
        elif t == 'SPHERICAL_SURFACE':
            ref = self.w.add("SPHERICAL_SURFACE('',%s,%s)" % (pl, fmt(sd['radius'])), at_id=at)
        elif t == 'TOROIDAL_SURFACE':
            ref = self.w.add("TOROIDAL_SURFACE('',%s,%s,%s)"
                             % (pl, fmt(sd['majorRadius']), fmt(sd['minorRadius'])), at_id=at)
        self._surfaces[sid] = ref
        return ref

    def edge(self, eid):
        """Build EDGE_CURVE for ``eid``, or return None if its geometry is
        unsupported (a neglected "/failed" feature)."""
        if eid in self._edges:
            return self._edges[eid]
        ed = self.emap[eid]
        v1, v2 = ed['vertices']
        try:
            cref = self.curve(ed['curve'])
            ref = self.w.add("EDGE_CURVE('',%s,%s,%s,%s)"
                             % (self.vertex(v1), self.vertex(v2), cref,
                                '.T.' if ed.get('sameSense') else '.F.'),
                             at_id=int(eid[1:]) if self.preserve_ids else None)
        except UnsupportedGeometry as ex:
            self._edges[eid] = None
            self.skipped['edges'].append(eid)
            self.skipped['reasons'].setdefault('edge:%s' % eid, str(ex))
            return None
        self._edges[eid] = ref
        self.edge_ref[eid] = ref
        return ref

    def face(self, fid):
        """Build ADVANCED_FACE for ``fid``, or return None if its surface (or a
        bounding edge) is unsupported. A face is only *neglected* as a whole --
        we never emit a face with missing bounds or placeholder geometry."""
        if fid in self._faces:
            return self._faces[fid]
        fd = self.fmap[fid]
        try:
            surf_ref = self.surface(fd['surface'])
        except UnsupportedGeometry as ex:
            self._faces[fid] = None
            self.skipped['faces'].append(fid)
            self.skipped['reasons'].setdefault('face:%s' % fid, str(ex))
            return None
        bounds = []
        for b in fd['bounds']:
            if b.get('vertexLoop'):
                vtx = self.vertex(b.get('vertexLoopVtx'))
                loop = self.w.add("VERTEX_LOOP('',%s)" % vtx)
                bound_type = 'FACE_OUTER_BOUND' if b.get('outer') else 'FACE_BOUND'
                bounds.append(self.w.add("%s('',%s,%s)"
                                         % (bound_type, loop,
                                            '.T.' if b.get('orientation') else '.F.')))
                continue
            oes = []
            unsupported = False
            for eid, orient in b['edges']:
                eref = self.edge(eid)
                if eref is None:
                    unsupported = True
                    break
                oes.append(self.w.add("ORIENTED_EDGE('',*,*,%s,%s)"
                                      % (eref, '.T.' if orient else '.F.')))
            if unsupported:
                self._faces[fid] = None
                self.skipped['faces'].append(fid)
                self.skipped['reasons'].setdefault(
                    'face:%s' % fid, 'bounds reference unsupported edge(s)')
                return None
            loop = self.w.add("EDGE_LOOP('',(%s))" % ','.join(oes))
            bound_type = 'FACE_OUTER_BOUND' if b.get('outer') else 'FACE_BOUND'
            bounds.append(self.w.add("%s('',%s,%s)"
                                     % (bound_type, loop, '.T.' if b.get('orientation') else '.F.')))
        ref = self.w.add("ADVANCED_FACE('',(%s),%s,%s)"
                         % (','.join(bounds), surf_ref,
                            '.T.' if fd.get('sameSense') else '.F.'),
                         at_id=int(fid[1:]) if self.preserve_ids else None)
        self._faces[fid] = ref
        self.face_ref[fid] = ref
        return ref

    # ------------------------------------------------------------ assembly
    def _length_unit(self):
        """Emit the LENGTH_UNIT matching the graph's source file.

        The exporter records ``source.lengthUnit`` / ``source.scaleToMillimeters``;
        the coordinates in ``geometry`` are in those source units, so the rebuilt
        file must declare the *same* modal length unit or every reader will see
        the part scaled by the unit ratio.
        """
        src = (self.g.get('source') or {})
        scale = src.get('scaleToMillimeters')
        name = str(src.get('lengthUnit') or '').lower()
        # inch (and its row: foot/yard are uncommon in STEP parts)
        if (scale is not None and abs(float(scale) - 25.4) < 1e-9) or 'inch' in name:
            base_mm = self.w.add_complex([
                ('LENGTH_UNIT', ''),
                ('NAMED_UNIT', '*'),
                ('SI_UNIT', '.MILLI.,.METRE.'),
            ])
            factor = self.w.add("LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),%s)" % base_mm)
            return self.w.add_complex([
                ('CONVERSION_BASED_UNIT', "'INCH',%s" % factor),
                ('LENGTH_UNIT', ''),
                ('NAMED_UNIT', '*'),
            ])
        prefix = '.MILLI.'
        if scale is not None:
            try:
                s = float(scale)  # millimetres per source unit
            except (TypeError, ValueError):
                s = 1.0
            powers = [(1e-3, '.MICRO.'), (1.0, '.MILLI.'), (1e3, '$'),
                      (1e6, '.KILO.'), (1e9, '.MEGA.')]
            for val, tok in powers:
                if abs(s - val) <= max(1e-12, val * 1e-9):
                    prefix = tok
                    break
        return self.w.add_complex([
            ('LENGTH_UNIT', ''),
            ('NAMED_UNIT', '*'),
            ('SI_UNIT', '%s,.METRE.' % prefix),
        ])

    # ------------------------------------------------------------ assembly
    def build(self):
        g = self.g
        # ---- lookups ----
        self.vmap = {v['id']: v['point'] for v in self.geo['vertices']}
        self.cmap = {c['id']: c for c in self.geo['curves']}
        self.smap = {s['id']: s for s in self.geo['surfaces']}
        self.emap = {e['id']: e for e in self.geo['edges']}
        self.fmap = {f['id']: f for f in self.geo['faces']}

        # ---- reserve original entity ids so synthesized helpers never collide
        if self.preserve_ids:
            for rec in (self.geo['vertices'] + self.geo['edges'] + self.geo['curves']
                        + self.geo['surfaces'] + self.geo['faces'] + self.geo['shells']):
                self.w.reserve(rec.get('id'))

        # ---- units + geometric context ----
        # Modal units must be preserved: the graph stores raw coordinates in the
        # source file's units (e.g. an inch file keeps inch numbers), so writing
        # SI millimetres here would rescale the whole part by 25.4.
        unit_len = self._length_unit()
        self.unit_len = unit_len
        # Millimetres per file length unit. PMI measures are stored in the graph
        # in millimetres (``nominalMm`` etc.), but they are written against
        # ``unit_len``, so they must be converted back into the file's own unit
        # first -- otherwise an inch file declares a 254 mm value as 254 inch.
        try:
            self.mm_per_unit = float((self.g.get('source') or {}).get('scaleToMillimeters') or 1.0)
        except (TypeError, ValueError):
            self.mm_per_unit = 1.0
        if not self.mm_per_unit:
            self.mm_per_unit = 1.0
        unit_ang = self.w.add_complex([
            ('NAMED_UNIT', '*'),
            ('PLANE_ANGLE_UNIT', ''),
            ('SI_UNIT', '$,.RADIAN.'),
        ])
        unit_sol = self.w.add_complex([
            ('NAMED_UNIT', '*'),
            ('SI_UNIT', '$,.STERADIAN.'),
            ('SOLID_ANGLE_UNIT', ''),
        ])
        ctx = self.w.add_complex([
            ('GEOMETRIC_REPRESENTATION_CONTEXT', '3'),
            ('GLOBAL_UNIT_ASSIGNED_CONTEXT', '(%s,%s,%s)' % (unit_len, unit_ang, unit_sol)),
            ('REPRESENTATION_CONTEXT', "'3','3D'"),
        ])
        self.ctx = ctx

        # ---- product chain ----
        app = self.w.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')")
        self.w.add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,%s)" % app)
        pctx = self.w.add("PRODUCT_CONTEXT('',%s,'mechanical')" % app)
        product = self.w.add("PRODUCT('PartBody','PartBody','',(%s))" % pctx)
        pdf = self.w.add("PRODUCT_DEFINITION_FORMATION('','',%s)" % product)
        pdctx = self.w.add("PRODUCT_DEFINITION_CONTEXT('part definition',%s,'design')" % app)
        pd = self.w.add("PRODUCT_DEFINITION('design','',%s,%s)" % (pdf, pdctx))
        pds = self.w.add("PRODUCT_DEFINITION_SHAPE('','Rebuilt Shape',%s)" % pd)
        self.pds = pds

        # ---- solids ----
        # Faces whose geometry the rebuilder cannot reproduce are *neglected*
        # (self.face returns None); the shell is rebuilt from the supported
        # subset. This keeps the rebuild faithful to what the graph models.
        solids = []
        for sh in self.geo['shells']:
            faces = [f for f in (self.face(fid) for fid in sh['faces']) if f]
            if not faces:
                self.skipped['reasons']['shell:%s' % sh['id']] = \
                    'all faces unsupported -- shell omitted'
                continue
            shell_type = 'CLOSED_SHELL' if sh.get('closed') else 'OPEN_SHELL'
            shell = self.w.add("%s('PartBody',(%s))" % (shell_type, ','.join(faces)),
                               at_id=int(sh['id'][1:]) if self.preserve_ids else None)
            solids.append(self.w.add("MANIFOLD_SOLID_BREP('PartBody',%s)" % shell))
        # ---- tessellated solids (TESSELLATED_SOLID / TRIANGULATED_FACE) ----
        # A tessellated representation cannot be expressed as ADVANCED_FACE;
        # it is rebuilt verbatim as a TESSELLATED_SOLID so the geometry the
        # graph carries is not silently dropped.
        tess_items = self._reconstruct_tessellated()
        # The product's own representation stays a plain (or B-rep) shape
        # representation; the tessellation is attached through a representation
        # relationship, the structure AP242 tessellated files use. Readers that
        # cannot build a B-Rep from a TESSELLATED_SHAPE_REPRESENTATION (OCCT is
        # one) reject the file when it is the product's top-level shape.
        if solids:
            absr = self.w.add("ADVANCED_BREP_SHAPE_REPRESENTATION('PartBody',(%s),%s)"
                              % (','.join(solids), ctx))
        elif self._faceted_solids:
            # A TESSELLATED_SOLID alone renders as an empty model in readers
            # that do not tessellate AP242 tessellated geometry (OCCT among
            # them). The same surface is also written as a faceted B-rep, made
            # of exactly the source triangles, so the model is visible while the
            # tessellated representation below keeps the original precision.
            absr = self.w.add("ADVANCED_BREP_SHAPE_REPRESENTATION('PartBody',(%s),%s)"
                              % (','.join(self._faceted_solids), ctx))
        else:
            # A plain shape representation carrying the canonical identity axis
            # placement, as the source tessellated files do.
            origin = self.placement((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0))
            absr = self.w.add("SHAPE_REPRESENTATION('PartBody',(%s),%s)" % (origin, ctx))
        if tess_items:
            trepr = self.w.add("TESSELLATED_SHAPE_REPRESENTATION('PartBody',(%s),%s)"
                               % (','.join(tess_items), ctx))
            self.w.add("SHAPE_REPRESENTATION_RELATIONSHIP('','',%s,%s)" % (trepr, absr))
        self.absr = absr
        self.w.add("SHAPE_DEFINITION_REPRESENTATION(%s,%s)" % (pds, absr))

        # ---- semantic PMI ----
        self._build_pmi()

    # ------------------------------------------------------------ tessellation
    def _reconstruct_tessellated(self):
        """Emit the tessellated geometry carried by the graph, if any.

        Faces are written with the attribute order of the ISO 10303-42
        tessellated_geometry_schema:

          TRIANGULATED_FACE(name, coordinates, pnmax, normals, geometric_link,
                            pnindex, triangles)
          COMPLEX_TRIANGULATED_FACE(name, coordinates, pnmax, normals,
                            geometric_link, pnindex, triangle_strips,
                            triangle_fans)

        The graph's TESSELLATED_SOLID / TESSELLATED_SHELL structure is then
        reproduced with its original items, so the rebuilt file declares the
        same solid/shell composition as the source. Returns the top-level
        tessellated item refs (empty when the graph carries no tessellation).
        """
        geo = self.geo
        tess = geo.get('tessellated')
        if not tess or not tess.get('faces'):
            return []
        pools = {p['id']: p.get('points') for p in (tess.get('coordinatePools') or [])}
        pool_ref = {}   # pool id -> rebuilt COORDINATES_LIST ref (deduplicated)
        face_ref = {}
        tri_by_face = {}  # face id -> [(p0,p1,p2), ...] for the B-rep
        face_surface = {}  # face id -> exact supporting surface id
        for tf in tess['faces']:
            cid = tf.get('coordinates')
            coords = pools.get(cid) or tf.get('coordinates') or []
            # a legacy graph may inline the points on the face record itself
            if not coords and isinstance(tf.get('points'), list):
                coords = tf['points']
            if not coords:
                self.skipped.setdefault('tessFaces', []).append(tf.get('id'))
                self.skipped['reasons'].setdefault('tessFace:%s' % tf.get('id'),
                                                   'empty coordinate pool -- dropped')
                continue
            coord_ref = pool_ref.get(cid)
            if coord_ref is None:
                pool = '(%s)' % ','.join('(%s)' % ','.join(fmt(c) for c in pt) for pt in coords)
                coord_ref = self.w.add("COORDINATES_LIST('',%d,%s)" % (len(coords), pool))
                if cid:
                    pool_ref[cid] = coord_ref
            strips = tf.get('triangleStrips') or []
            fans = tf.get('triangleFans') or []
            tris = tf.get('triangles') or []
            kind = tf.get('kind')
            if not strips and not fans:
                # legacy graph: only the expanded triangles are known, and each
                # is a valid one-triangle strip.
                strips = [list(t) for t in tris]
            if not strips and not fans:
                self.skipped.setdefault('tessFaces', []).append(tf.get('id'))
                self.skipped['reasons'].setdefault('tessFace:%s' % tf.get('id'),
                                                   'no triangulation -- dropped')
                continue
            normals = tf.get('normals') or []
            normals_str = '(%s)' % ','.join(flist(n) for n in normals)
            pnindex = tf.get('pnindex') or []
            if not pnindex:
                pnindex = list(range(1, len(coords) + 1))
            pnindex_str = '(%s)' % ','.join(str(int(i)) for i in pnindex)
            pnmax = tf.get('pnmax')
            if pnmax is None:
                used = [int(i) for row in list(strips) + list(fans) for i in row]
                pnmax = max(used + [len(pnindex)]) if (used or pnindex) else 0
            # The triangle indices address the face's point-normal space;
            # ``pnindex`` maps each of those points into the shared coordinate
            # pool. Both are needed to place the triangles in model space.
            face_tris = tri_by_face.setdefault(tf.get('id'), [])
            for tri in (tris or _expand_triangles(strips, fans)):
                if len(tri) != 3:
                    continue
                try:
                    face_tris.append([coords[int(pnindex[int(i) - 1]) - 1]
                                      for i in tri])
                except (IndexError, TypeError, ValueError):
                    continue
            face_surface[tf.get('id')] = tf.get('surface')
            surf = None
            if tf.get('surface'):
                try:
                    surf = self.surface(tf['surface'])
                except UnsupportedGeometry:
                    surf = None
            link = surf or '$'
            is_complex = (kind == 'COMPLEX_TRIANGULATED_FACE'
                          or bool(fans)
                          or any(len(s) > 3 for s in strips))
            if is_complex:
                strips_str = '(%s)' % ','.join(
                    '(%s)' % ','.join(str(int(i)) for i in s) for s in strips)
                fans_str = '(%s)' % ','.join(
                    '(%s)' % ','.join(str(int(i)) for i in f) for f in fans)
                ref = self.w.add(
                    "COMPLEX_TRIANGULATED_FACE('',%s,%d,%s,%s,%s,%s,%s)"
                    % (coord_ref, pnmax, normals_str, link, pnindex_str,
                       strips_str, fans_str))
            else:
                tri_str = '(%s)' % ','.join(
                    '(%s)' % ','.join(str(int(i)) for i in s) for s in strips)
                ref = self.w.add(
                    "TRIANGULATED_FACE('',%s,%d,%s,%s,%s,%s)"
                    % (coord_ref, pnmax, normals_str, link, pnindex_str, tri_str))
            face_ref[tf['id']] = ref

        # shells first, so a solid that references a shell can point at it
        shell_ref = {}
        for sh in (tess.get('shells') or []):
            refs = [face_ref[f] for f in (sh.get('items') or sh.get('faces') or [])
                    if f in face_ref]
            if not refs:
                continue
            shell_ref[sh['id']] = self.w.add(
                "TESSELLATED_SHELL(%s,(%s),$)"
                % (_step_string(sh.get('name') or 'PartBody'), ','.join(refs)))

        used_shells = set()
        used_faces = set()
        solids = []
        solid_recs = tess.get('solids') or []
        for so in solid_recs:
            items = []
            ids = so.get('items')
            if ids:
                for it in ids:
                    if it in shell_ref:
                        items.append(shell_ref[it])
                        used_shells.add(it)
                    elif it in face_ref:
                        items.append(face_ref[it])
                        used_faces.add(it)
            else:
                for f in (so.get('faces') or []):
                    if f in face_ref:
                        items.append(face_ref[f])
                        used_faces.add(f)
            if not items:
                continue
            solids.append(self.w.add(
                "TESSELLATED_SOLID(%s,(%s),$)"
                % (_step_string(so.get('name') or 'PartBody'), ','.join(items))))

        # faces not referenced by any solid/shell -> keep them as one shell so
        # no tessellated geometry is silently lost
        covered = set(used_faces)
        for sh in (tess.get('shells') or []):
            covered.update(sh.get('items') or sh.get('faces') or [])
        leftover = [ref for fid, ref in face_ref.items() if fid not in covered]
        top_shells = [shell_ref[sid] for sid in shell_ref if sid not in used_shells]
        if leftover:
            top_shells.append(self.w.add(
                "TESSELLATED_SHELL('PartBody',(%s),$)" % ','.join(leftover)))
        self._faceted_solids = self._build_faceted_solids(tess, tri_by_face, face_surface)
        return solids + top_shells

    def _build_faceted_solids(self, tess, tri_by_face, face_surface):
        """Write the tessellation as B-reps (MANIFOLD_SOLID_BREPs).

        A TESSELLATED_SOLID is not readable by every consumer: OCCT -- and
        therefore most WASM/CAD viewers built on it -- ignores AP242 tessellated
        solids and draws an empty model. AP242 allows the same surface to be
        written a second time as a B-rep, so the rebuilt file carries one solid
        per ``TESSELLATED_SOLID`` the graph declares and keeps the original
        tessellated representation next to it.

        Every tessellated face names the exact surface it samples
        (``geometric_link``). Using it keeps the rebuilt solid analytic: a
        CYLINDRICAL_SURFACE face stays a cylinder bounded by its patch borders,
        B-spline faces stay B-splines. The tessellation border becomes the face
        boundary (largest loop as ``FACE_OUTER_BOUND``, the rest as
        ``FACE_BOUND``), which is faithful for these partial patches -- every
        cylindrical face here is a single-loop patch that never wraps a seam.
        Only a face whose surface is unsupported, or whose border cannot be
        chained into closed loops, falls back to one PLANE per triangle.
        """
        declared = tess.get('solids') or []
        shell_faces = {sh['id']: (sh.get('faces') or sh.get('items') or [])
                       for sh in (tess.get('shells') or [])}
        groups = []
        if declared:
            for so in declared:
                expanded = []
                for it in (so.get('items') or []):
                    if it in shell_faces:
                        expanded.extend(shell_faces[it])
                    elif it in tri_by_face:
                        expanded.append(it)
                if not expanded:
                    expanded = list(so.get('faces') or [])
                groups.append(list(dict.fromkeys(expanded)))
        else:
            groups.append(list(tri_by_face))

        # Boundary loops first: the same mesh segment is shared by two faces, so
        # the edge curves are built once and the faces point at them, which is
        # what makes the result a sewn shell rather than a bag of patches.
        info = {}
        seg_surfaces = {}
        for fid, tris in tri_by_face.items():
            sd = self.smap.get(face_surface.get(fid)) if face_surface.get(fid) else None
            loops = _boundary_loops(tris) if tris else []
            info[fid] = (sd, loops)
            for loop in loops:
                for i in range(len(loop)):
                    a, b = loop[i], loop[(i + 1) % len(loop)]
                    key = (a, b) if a < b else (b, a)
                    seg_surfaces.setdefault(key, []).append(sd)
        edge_ref = {}
        for key, sds in seg_surfaces.items():
            edge_ref[key] = self._edge_for_segment(key[0], key[1], sds)

        solids = []
        degenerate = 0
        faceted = 0
        for fids in groups:
            faces = []
            for fid in fids:
                tris = tri_by_face.get(fid) or []
                if not tris:
                    continue
                built, dropped, exact = self._face_from_tessellation(
                    tris, info.get(fid), edge_ref)
                degenerate += dropped
                if not exact:
                    faceted += 1
                faces.extend(built)
            if faces:
                shell = self.w.add("CLOSED_SHELL('PartBody',(%s))" % ','.join(faces))
                solids.append(self.w.add("MANIFOLD_SOLID_BREP('PartBody',%s)" % shell))
        if degenerate:
            self.skipped['reasons']['facetedBrep'] = \
                '%d degenerate triangle(s) omitted from the rebuilt B-rep' % degenerate
        if faceted:
            self.skipped['reasons']['facetedBrepFaces'] = \
                ('%d tessellated face(s) rebuilt as flat triangles because their '
                 'surface/border could not be used' % faceted)
        return solids

    def _tess_vertex(self, p):
        """Shared VERTEX_POINT for a tessellation corner."""
        key = p if isinstance(p, tuple) else tuple(p)
        ref = self._tess_vertices.get(key)
        if ref is None:
            ref = self.w.add("VERTEX_POINT('',%s)" % self.point(key))
            self._tess_vertices[key] = ref
        return ref

    def _edge_for_segment(self, p, q, sds):
        """Shared EDGE_CURVE for the segment ``p`` -> ``q``.

        The curve is reconstructed from the surfaces the segment bounds: an
        segment that is a circular arc of a cylindrical face becomes a real
        ``CIRCLE`` (both the hole wall and the planar cap that meets it reuse
        the same entity), everything else stays a straight ``LINE``. Writing the
        arcs exactly is what stops the cylinders from coming back faceted -- a
        polygonal boundary would be the only thing left approximating them.
        """
        dx = [float(q[i]) - float(p[i]) for i in range(3)]
        length = math.sqrt(sum(c * c for c in dx))
        if not length:
            return None
        v1 = self._tess_vertex(p)
        v2 = self._tess_vertex(q)
        for sd in sds:
            if not sd or sd.get('type') != 'CYLINDRICAL_SURFACE':
                continue
            origin = sd.get('origin')
            axis = _unit(sd.get('axis') or (0.0, 0.0, 0.0))
            radius = sd.get('radius')
            if not origin or not axis or not radius:
                continue
            radius = float(radius)
            z1 = sum((float(p[i]) - float(origin[i])) * axis[i] for i in range(3))
            z2 = sum((float(q[i]) - float(origin[i])) * axis[i] for i in range(3))
            if abs(z1 - z2) > 1e-3:
                continue
            centre = [float(origin[i]) + z1 * axis[i] for i in range(3)]
            radial1 = [float(p[i]) - centre[i] for i in range(3)]
            radial2 = [float(q[i]) - centre[i] for i in range(3)]
            r1 = math.sqrt(sum(c * c for c in radial1))
            r2 = math.sqrt(sum(c * c for c in radial2))
            if abs(r1 - radius) > 1e-2 or abs(r2 - radius) > 1e-2:
                continue
            u1 = tuple(c / r1 for c in radial1) if r1 else None
            u2 = tuple(c / r2 for c in radial2) if r2 else None
            if not u1 or not u2:
                continue
            turn = sum(_cross(u1, u2)[i] * axis[i] for i in range(3))
            if abs(turn) < 1e-9 and sum(u1[i] * u2[i] for i in range(3)) < 0:
                continue  # diametrically opposite: the arc is ambiguous
            # sweep in the direction of increasing parameter
            if turn < 0:
                axis = tuple(-c for c in axis)
            circle = self.w.add("CIRCLE('',%s,%s)"
                                % (self.placement(centre, axis, u1), fmt(radius)))
            return self.w.add("EDGE_CURVE('',%s,%s,%s,.T.)" % (v1, v2, circle))
        direction = tuple(c / length for c in dx)
        line = self.w.add("LINE('',%s,%s)" % (self.point(p), self.vector(direction, length)))
        return self.w.add("EDGE_CURVE('',%s,%s,%s,.T.)" % (v1, v2, line))

    def _edge_loop(self, loop, edge_ref):
        """EDGE_LOOP for one tessellation boundary loop, or None."""
        oriented = []
        for i in range(len(loop)):
            a, b = loop[i], loop[(i + 1) % len(loop)]
            key = (a, b) if a < b else (b, a)
            ref = edge_ref.get(key)
            if not ref:
                return None
            same = '.T.' if (a, b) == key else '.F.'
            oriented.append(self.w.add("ORIENTED_EDGE('',*,*,%s,%s)" % (ref, same)))
        if len(oriented) < 3:
            return None
        return self.w.add("EDGE_LOOP('',(%s))" % ','.join(oriented))

    def _face_from_tessellation(self, tris, info, edge_ref):
        """One FACE_SURFACE on the face's own surface, or flat triangles.

        Returns ``(face_refs, degenerate_count, exact)`` where ``exact`` is True
        when the face was written on its supporting surface.
        """
        sd, loops = info if info else (None, [])
        if sd is not None and loops:
            sid = sd.get('id')
            try:
                surf = self.surface(sid)
            except UnsupportedGeometry:
                surf = None
            normal = _face_normal(tris)
            if surf and normal:
                bounds = self._loop_bounds(loops, normal, edge_ref)
                if bounds:
                    return [self.w.add("FACE_SURFACE('',(%s),%s,%s)"
                                       % (','.join(bounds), surf,
                                          _same_sense(sd, loops[0], normal)))], 0, True
        faces, dropped = self._triangle_faces(tris)
        return faces, dropped, False

    def _loop_bounds(self, loops, normal, edge_ref):
        """FACE_OUTER_BOUND / FACE_BOUND chain for a patch's boundary loops."""
        def projected_area(loop):
            total = 0.0
            for i in range(len(loop)):
                a, b = loop[i], loop[(i + 1) % len(loop)]
                c = _cross(a, b)
                total += c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2]
            return abs(total)

        order = sorted(range(len(loops)), key=lambda i: -projected_area(loops[i]))
        bounds = []
        for rank, i in enumerate(order):
            loop = self._edge_loop(loops[i], edge_ref)
            if loop is None:
                return None
            kind = 'FACE_OUTER_BOUND' if rank == 0 else 'FACE_BOUND'
            bounds.append(self.w.add("%s('',%s,.T.)" % (kind, loop)))
        return bounds

    def _triangle_faces(self, tri_points):
        """Per-triangle PLANE faces -- the fallback when no surface is usable."""
        faces = []
        degenerate = 0
        for tri in tri_points:
            p0, p1, p2 = tri
            u = [float(p1[i]) - float(p0[i]) for i in range(3)]
            v = [float(p2[i]) - float(p0[i]) for i in range(3)]
            n = _cross(u, v)
            length = math.sqrt(sum(c * c for c in n))
            if not length:
                # collinear / repeated points -- no plane can be defined
                degenerate += 1
                continue
            n = tuple(c / length for c in n)
            plane = self.w.add("PLANE('',%s)" % self.placement(p0, n, _perp(n)))
            loop = self.w.add("POLY_LOOP('',(%s))"
                              % ','.join(self.point(p) for p in (p0, p1, p2)))
            bound = self.w.add("FACE_OUTER_BOUND('',%s,.T.)" % loop)
            faces.append(self.w.add("FACE_SURFACE('',(%s),%s,.T.)" % (bound, plane)))
        return faces, degenerate

    # ------------------------------------------------------------ PMI
    def _pm_edges_for(self, node_id):
        """Resolved PMI->topology face targets for a node, de-duplicated."""
        targets = []
        for e in self.g['edges']:
            if e['type'] == 'PMI-Topology' and e['source'] == node_id \
                    and e.get('resolution') == 'resolved' and e.get('target'):
                tid = e['target']
                if tid not in targets:
                    targets.append(tid)
        return targets

    def _ref_for_target(self, node_id):
        """Graph topology node id (Face-N / Edge-...) -> rebuilt entity ref."""
        node = self.node_by_id.get(node_id)
        if not node:
            return None
        if node['type'] == 'Face':
            return self.face_ref.get(node.get('stepEntityId'))
        if node['type'] == 'Edge':
            return self.edge_ref.get(node.get('stepEntityId'))
        return None

    def _build_pmi(self):
        g = self.g
        self.node_by_id = {n['id']: n for n in g['nodes']}

        datums = [n for n in g['nodes'] if n['type'] == 'Datum']
        tolerances = [n for n in g['nodes'] if n['type'] == 'GeometricTolerance']
        dimensions = [n for n in g['nodes'] if n['type'] == 'Dimension']
        drfs = [n for n in g['nodes'] if n['type'] == 'DatumReferenceFrame']
        if not (datums or tolerances or dimensions):
            self.pmi_written = {'datums': 0, 'tolerances': 0, 'dimensions': 0, 'drfs': 0}
            return

        # datum label -> DATUM ref
        datum_ref = {}
        for d in datums:
            label = d['label']
            df = self.w.add("DATUM_FEATURE('',$,%s,.T.)" % self.pds)
            dm = self.w.add("DATUM('',$,%s,.F.,'%s')" % (self.pds, label))
            self.w.add("SHAPE_ASPECT_RELATIONSHIP('',$,%s,%s)" % (df, dm))
            # link the datum feature (and thus the datum) to its faces
            for tid in self._pm_edges_for(d['id']):
                tref = self._ref_for_target(tid)
                if tref:
                    self.w.add("GEOMETRIC_ITEM_SPECIFIC_USAGE('','','DATUM',%s,%s,%s)"
                               % (df, self.absr, tref))
            datum_ref[label] = dm

        # datum reference frames: label -> DATUM_SYSTEM ref
        drf_ref = {}
        comp_of_drf = {}
        for e in g['edges']:
            if e['type'] == 'Component':
                comp_of_drf.setdefault(e['source'], []).append((e.get('order', 0), e['target']))
        for drf in drfs:
            labels = drf.get('orderedDatums') or []
            comps = sorted(comp_of_drf.get(drf['id'], []))
            ordered = []
            for _order, target in comps:
                tn = self.node_by_id.get(target)
                if tn and tn['type'] == 'Datum':
                    ordered.append(tn['label'])
            if not ordered:
                ordered = labels
            refs = []
            for lb in ordered:
                dm = datum_ref.get(lb)
                if dm is None:
                    dm = self.w.add("DATUM('',$,%s,.F.,'%s')" % (self.pds, lb))
                    datum_ref[lb] = dm
                refs.append(self.w.add("DATUM_REFERENCE_COMPARTMENT('',$,%s,.F.,%s,$)"
                                       % (self.pds, dm)))
            drf_ref[drf['id']] = self.w.add("DATUM_SYSTEM('%s',$,%s,.F.,(%s))"
                                            % (drf['name'], self.pds, ','.join(refs)))

        # tolerance -> DRF (from DatumReference edges)
        tol_drf = {}
        for e in g['edges']:
            if e['type'] == 'DatumReference':
                tol_drf[e['source']] = e['target']

        # ---- helper: build the aspect chain for one PMI item ----
        def aspect_chain(node_id, descr):
            targets = self._pm_edges_for(node_id)
            comps = []
            for tid in targets:
                tref = self._ref_for_target(tid)
                if not tref:
                    continue
                comp = self.w.add("SHAPE_ASPECT('','%s',%s,.T.)" % (descr, self.pds))
                self.w.add("GEOMETRIC_ITEM_SPECIFIC_USAGE('','','%s',%s,%s,%s)"
                           % (descr, comp, self.absr, tref))
                comps.append(comp)
            if not comps:
                return self.w.add("SHAPE_ASPECT('','%s',%s,.T.)" % (descr, self.pds)), False
            if len(comps) == 1:
                return comps[0], False
            comp = self.w.add("COMPOSITE_SHAPE_ASPECT('','%s',%s,.F.)" % (descr, self.pds))
            for c in comps:
                self.w.add("SHAPE_ASPECT_RELATIONSHIP('',$,%s,%s)" % (comp, c))
            return comp, True

        def measure(value_mm):
            if value_mm is None:
                return '$'
            # The graph's PMI measures are in millimetres; the measure is tagged
            # with the file's length unit, so convert into that unit first.
            value = float(value_mm) / self.mm_per_unit
            return self.w.add_complex([
                ('LENGTH_MEASURE_WITH_UNIT', ''),
                ('MEASURE_REPRESENTATION_ITEM', ''),
                ('MEASURE_WITH_UNIT',
                 'LENGTH_MEASURE(%s),%s' % (fmt(value), self.unit_len)),
                ('REPRESENTATION_ITEM', "''"),
            ])

        # ---- geometric tolerances ----
        for t in tolerances:
            aspect, _ = aspect_chain(t['id'], 'GDT')
            m = measure(t.get('toleranceValueMm', t.get('toleranceValue')))
            comps = [('GEOMETRIC_TOLERANCE',
                      "'%s','',%s,%s" % (t.get('name', ''), m, aspect))]
            drf_id = tol_drf.get(t['id'])
            drf_r = drf_ref.get(drf_id)
            if drf_r or t.get('datumReferences'):
                if drf_r is None:
                    # fall back to an ad-hoc datum system built from the letters
                    refs = []
                    for lb in t.get('datumReferences') or []:
                        dm = datum_ref.get(lb) or self.w.add(
                            "DATUM('',$,%s,.F.,'%s')" % (self.pds, lb))
                        datum_ref[lb] = dm
                        refs.append(self.w.add(
                            "DATUM_REFERENCE_COMPARTMENT('',$,%s,.F.,%s,$)" % (self.pds, dm)))
                    drf_r = self.w.add("DATUM_SYSTEM('',$,%s,.F.,(%s))"
                                       % (self.pds, ','.join(refs)))
                comps.append(('GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE', '(%s)' % drf_r))
            ent = TOL_ENTITY.get((t.get('toleranceType') or '').strip().lower(), 'GEOMETRIC_TOLERANCE')
            comps.append((ent, ''))
            self.w.add_complex(comps)

        # ---- dimensional sizes ----
        for d in dimensions:
            aspect, _ = aspect_chain(d['id'], 'DIMENSION')
            size = self.w.add("DIMENSIONAL_SIZE(%s,'%s')" % (aspect, d.get('name', '')))
            items = []
            for value, role in (('nominalMm', 'nominal value'),
                                ('upperMm', 'upper tolerance'),
                                ('lowerMm', 'lower tolerance')):
                value = d.get(value)
                if value is None:
                    continue
                # ``*Mm`` values are millimetres; the measure is tagged with the
                # file's length unit, so convert back into that unit first.
                value = float(value) / self.mm_per_unit
                unit = self.unit_len
                items.append(self.w.add_complex([
                    ('LENGTH_MEASURE_WITH_UNIT', ''),
                    ('MEASURE_REPRESENTATION_ITEM', ''),
                    ('MEASURE_WITH_UNIT', 'LENGTH_MEASURE(%s),%s' % (fmt(value), unit)),
                    ('REPRESENTATION_ITEM', "'%s'" % role),
                ]))
            # Older graphs only carry unitless (source-unit) values.
            if not items:
                for key, role in (('nominal', 'nominal value'),
                                  ('upper', 'upper tolerance'),
                                  ('lower', 'lower tolerance')):
                    value = d.get(key)
                    if value is None:
                        continue
                    items.append(self.w.add_complex([
                        ('LENGTH_MEASURE_WITH_UNIT', ''),
                        ('MEASURE_REPRESENTATION_ITEM', ''),
                        ('MEASURE_WITH_UNIT',
                         'LENGTH_MEASURE(%s),%s' % (fmt(value), self.unit_len)),
                        ('REPRESENTATION_ITEM', "'%s'" % role),
                    ]))
            if items:
                sdr = self.w.add("SHAPE_DIMENSION_REPRESENTATION('',(%s),%s)"
                                 % (','.join(items), self.ctx))
                self.w.add("DIMENSIONAL_CHARACTERISTIC_REPRESENTATION(%s,%s)" % (size, sdr))

        self.pmi_written = {'datums': len(datums), 'tolerances': len(tolerances),
                            'dimensions': len(dimensions), 'drfs': len(drfs)}

    # ------------------------------------------------------------ output
    def to_step(self, source_name):
        head = []
        head.append('ISO-10303-21;')
        head.append('HEADER;')
        head.append("FILE_DESCRIPTION(('Rebuilt from graph export by step_graph_rebuild.py'),'2;1');")
        head.append("FILE_NAME('%s','%s',(''),(''),"
                    "'step_graph_rebuild.py','step_graph_rebuild.py','');"
                    % (source_name, '2026-01-01T00:00:00'))
        head.append("FILE_SCHEMA(('%s'));" % SCHEMA)
        head.append('ENDSEC;')
        head.append('DATA;')
        tail = ['ENDSEC;', 'END-ISO-10303-21;']
        return '\n'.join(head + self.w.lines + tail) + '\n'


def default_out_path(graph_path):
    """``part.graph.json`` -> ``part.rebuilt.stp`` next to the graph."""
    directory = os.path.dirname(os.path.abspath(graph_path))
    base = os.path.basename(graph_path)
    if base.endswith('.graph.json'):
        base = base[:-len('.graph.json')]
    else:
        base = os.path.splitext(base)[0]
    return os.path.join(directory, base + '.rebuilt.stp')


def rebuild(graph_path, out_path=None, preserve_ids=False):
    """Rebuild ``graph_path`` into ``out_path`` (default: next to the graph)."""
    global _last_rebuilder
    out_path = out_path or default_out_path(graph_path)
    with open(graph_path, 'r', encoding='utf-8') as f:
        graph = json.load(f)
    if graph.get('graphVersion', 1) < 2 or 'geometry' not in graph:
        raise SystemExit('graph has no geometry section (graphVersion>=2 required); '
                         're-run step_graph_export.py')
    rb = Rebuilder(graph, preserve_ids=preserve_ids)
    rb.build()
    _last_rebuilder = rb
    text = rb.to_step(graph.get('source', {}).get('file', 'rebuilt.stp'))
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(text)
    print('rebuilt: %s' % out_path)
    print('  preserve_ids: %s' % preserve_ids)
    print('  entities: %d' % rb.w._n)
    print('  geometry: %d vertices, %d edges, %d curves, %d surfaces, %d faces, %d shells'
          % (len(rb.geo['vertices']), len(rb.geo['edges']), len(rb.geo['curves']),
             len(rb.geo['surfaces']), len(rb.geo['faces']), len(rb.geo['shells'])))
    print('  PMI: %s' % rb.pmi_written)
    sk = rb.skipped
    if sk['faces'] or sk['edges']:
        print('  neglected (unsupported) features:')
        print('    faces dropped   : %d %s' % (len(sk['faces']), sk['faces'][:8]))
        print('    edges dropped   : %d %s' % (len(sk['edges']), sk['edges'][:8]))
        for k in list(sk['reasons'])[:6]:
            print('      - %s: %s' % (k, sk['reasons'][k]))
    else:
        print('  neglected (unsupported) features: none')
    rb.out_path = out_path
    return out_path


def rebuild_object(graph_path, out_path=None, preserve_ids=False):
    """Rebuild and return the Rebuilder (for callers that need the skip record)."""
    rebuild(graph_path, out_path, preserve_ids=preserve_ids)
    return _last_rebuilder


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(
        prog='step_graph_rebuild.py',
        description='Rebuild a STEP file from a graph exported by '
                    'step_graph_export.py (graphVersion >= 2, geometry section).')
    ap.add_argument('graph', help='input .graph.json produced by step_graph_export.py')
    ap.add_argument('out', nargs='?', default=None,
                    help='output .stp (default: <graph base>.rebuilt.stp next to the graph)')
    ap.add_argument('--preserve-ids', action='store_true',
                    help='reuse the original STEP entity ids recorded in the graph for the '
                         'B-Rep core (vertices, edges, curves, surfaces, faces, shells)')
    a = ap.parse_args(argv)
    if not os.path.isfile(a.graph):
        ap.error('no such file: %s' % a.graph)
    rebuild(a.graph, a.out, preserve_ids=a.preserve_ids)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
