#ifdef EMSCRIPTEN

#include "native-topology-export.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <Bnd_Box.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepGProp.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <Geom2d_Curve.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomLProp_SLProps.hxx>
#include <GProp_GProps.hxx>
#include <Precision.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListIteratorOfListOfShape.hxx>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace
{

double GetLinearDeflection (const TopoDS_Shape& shape, const ImportParams& params)
{
    double deflection = params.linearDeflection;
    if (params.linearDeflectionType == ImportParams::LinearDeflectionType::BoundingBoxRatio) {
        Bnd_Box boundingBox;
        BRepBndLib::Add (shape, boundingBox, false);
        if (!boundingBox.IsVoid ()) {
            Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
            boundingBox.Get (xMin, yMin, zMin, xMax, yMax, zMax);
            const double averageSize =
                ((xMax - xMin) + (yMax - yMin) + (zMax - zMin)) / 3.0;
            deflection = averageSize * params.linearDeflection;
        }
    }
    return std::max (deflection, static_cast<double> (Precision::Confusion ()));
}

std::string GetCurveTypeName (const GeomAbs_CurveType curveType)
{
    switch (curveType) {
        case GeomAbs_Line: return "line";
        case GeomAbs_Circle: return "circle";
        case GeomAbs_Ellipse: return "ellipse";
        case GeomAbs_Hyperbola: return "hyperbola";
        case GeomAbs_Parabola: return "parabola";
        case GeomAbs_BezierCurve: return "bezier";
        case GeomAbs_BSplineCurve: return "bspline";
        case GeomAbs_OffsetCurve: return "offset";
        default: return "other";
    }
}

std::string GetSurfaceTypeName (const GeomAbs_SurfaceType surfaceType)
{
    switch (surfaceType) {
        case GeomAbs_Plane: return "plane";
        case GeomAbs_Cylinder: return "cylinder";
        case GeomAbs_Cone: return "cone";
        case GeomAbs_Sphere: return "sphere";
        case GeomAbs_Torus: return "torus";
        case GeomAbs_BezierSurface: return "bezier";
        case GeomAbs_BSplineSurface: return "bspline";
        case GeomAbs_SurfaceOfRevolution: return "revolution";
        case GeomAbs_SurfaceOfExtrusion: return "extrusion";
        case GeomAbs_OffsetSurface: return "offset";
        default: return "other";
    }
}

std::vector<gp_Pnt> DiscretizeEdge (
    const TopoDS_Edge& edge,
    const double linearDeflection,
    const double angularDeflection
)
{
    std::vector<gp_Pnt> points;
    try {
        BRepAdaptor_Curve curve (edge);
        const Standard_Real firstParameter = curve.FirstParameter ();
        const Standard_Real lastParameter = curve.LastParameter ();
        if (!Precision::IsInfinite (firstParameter) &&
            !Precision::IsInfinite (lastParameter)) {
            GCPnts_TangentialDeflection discretizer (
                curve,
                firstParameter,
                lastParameter,
                std::max (angularDeflection, 1.0e-4),
                linearDeflection,
                2
            );
            const Standard_Integer pointCount = discretizer.NbPoints ();
            points.reserve (pointCount);
            for (Standard_Integer pointIndex = 1; pointIndex <= pointCount; pointIndex++) {
                points.push_back (discretizer.Value (pointIndex));
            }
        }
    } catch (const Standard_Failure&) {
        points.clear ();
    }

    if (points.size () < 2) {
        TopoDS_Vertex firstVertex;
        TopoDS_Vertex lastVertex;
        TopExp::Vertices (edge, firstVertex, lastVertex);
        if (!firstVertex.IsNull ()) {
            points.push_back (BRep_Tool::Pnt (firstVertex));
        }
        if (!lastVertex.IsNull ()) {
            points.push_back (BRep_Tool::Pnt (lastVertex));
        }
    }
    return points;
}

bool HasDrawableSegment (const std::vector<gp_Pnt>& points)
{
    for (std::size_t pointIndex = 0; pointIndex + 1 < points.size (); pointIndex++) {
        if (points[pointIndex].SquareDistance (points[pointIndex + 1]) >
            Precision::SquareConfusion ()) {
            return true;
        }
    }
    return false;
}

void WritePoint (emscripten::val& output, const gp_Pnt& point)
{
    output.set (0, point.X ());
    output.set (1, point.Y ());
    output.set (2, point.Z ());
}

void WriteDirection (emscripten::val& output, const gp_Dir& direction)
{
    output.set (0, direction.X ());
    output.set (1, direction.Y ());
    output.set (2, direction.Z ());
}

void WriteBounds (emscripten::val& output, const Bnd_Box& bounds)
{
    if (bounds.IsVoid ()) {
        return;
    }
    Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
    bounds.Get (xMin, yMin, zMin, xMax, yMax, zMax);
    output.set (0, xMin);
    output.set (1, yMin);
    output.set (2, zMin);
    output.set (3, xMax);
    output.set (4, yMax);
    output.set (5, zMax);
}

/**
 * Outward unit normal of `face` at surface parameters (u, v). The surface
 * normal is flipped when the face is REVERSED so the result always points away
 * from the material of the solid that owns the face.
 */
bool OutwardNormalAt (
    const TopoDS_Face& face,
    const Standard_Real u,
    const Standard_Real v,
    gp_Dir& normal
)
{
    const Handle(Geom_Surface)& surface = BRep_Tool::Surface (face);
    if (surface.IsNull ()) {
        return false;
    }
    try {
        GeomLProp_SLProps props (surface, u, v, 2, Precision::Confusion ());
        if (!props.IsNormalDefined ()) {
            return false;
        }
        gp_Vec surfaceNormal = props.Normal ();
        if (surfaceNormal.Magnitude () <= Precision::Confusion ()) {
            return false;
        }
        if (face.Orientation () == TopAbs_REVERSED) {
            surfaceNormal.Reverse ();
        }
        normal = gp_Dir (surfaceNormal.X (), surfaceNormal.Y (), surfaceNormal.Z ());
        return true;
    } catch (const Standard_Failure&) {
        return false;
    }
}

/**
 * Projects `reference` onto the face's natural surface and returns the nearest
 * surface point together with the corresponding surface parameters.
 */
bool NearestSurfacePoint (
    const Handle(Geom_Surface)& surface,
    const gp_Pnt& reference,
    gp_Pnt& nearest,
    Standard_Real& u,
    Standard_Real& v
)
{
    if (surface.IsNull ()) {
        return false;
    }
    try {
        GeomAPI_ProjectPointOnSurf projection (
            reference,
            surface,
            Precision::Confusion ()
        );
        if (!projection.IsDone () || projection.NbPoints () < 1) {
            return false;
        }
        nearest = projection.NearestPoint ();
        projection.LowerDistanceParameters (u, v);
        return true;
    } catch (const Standard_Failure&) {
        return false;
    }
}

/**
 * Kernel face-level convexity for analyically curved faces. For a cylinder the
 * face is `convex` (boss) when its outward normal points away from the axis
 * and `concave` (bore) when it points toward the axis; for a sphere the same
 * test is anchored on the sphere center. The sign is constant over the whole
 * connected surface, so the classification is sampled over the bounding-box
 * corners projected onto the surface. Mirrors the thresholds of the former
 * tessellation-side fit (`> 0.05` convex, `< -0.05` concave).
 */
std::string FaceConvexityLabel (const TopoDS_Face& face)
{
    try {
        BRepAdaptor_Surface surface (face, false);
        const GeomAbs_SurfaceType type = surface.GetType ();
        gp_XYZ axisDirection (0.0, 0.0, 1.0);
        gp_Pnt center;
        Standard_Boolean radialFromCenter = Standard_False;
        if (type == GeomAbs_Cylinder) {
            const gp_Cylinder cylinder = surface.Cylinder ();
            axisDirection = cylinder.Axis ().Direction ().XYZ ();
            center = cylinder.Location ();
        } else if (type == GeomAbs_Sphere) {
            center = surface.Sphere ().Location ();
            radialFromCenter = Standard_True;
        } else {
            return "unknown";
        }

        Bnd_Box bounds;
        BRepBndLib::Add (face, bounds, false);
        if (bounds.IsVoid ()) {
            return "unknown";
        }
        Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
        bounds.Get (xMin, yMin, zMin, xMax, yMax, zMax);
        const Standard_Real probeCoordinates[8][3] = {
            { xMin, yMin, zMin }, { xMax, yMin, zMin }, { xMin, yMax, zMin },
            { xMin, yMin, zMax }, { xMax, yMax, zMin }, { xMax, yMin, zMax },
            { xMin, yMax, zMax }, { xMax, yMax, zMax }
        };

        const Handle(Geom_Surface)& surfaceHandle = BRep_Tool::Surface (face);
        Standard_Real dotSum = 0.0;
        Standard_Integer samples = 0;
        for (Standard_Integer probeIndex = 0; probeIndex < 8; probeIndex++) {
            gp_Pnt nearest;
            Standard_Real u, v;
            if (!NearestSurfacePoint (
                    surfaceHandle,
                    gp_Pnt (probeCoordinates[probeIndex][0],
                        probeCoordinates[probeIndex][1],
                        probeCoordinates[probeIndex][2]),
                    nearest,
                    u,
                    v
                )) {
                continue;
            }
            gp_Dir outward;
            if (!OutwardNormalAt (face, u, v, outward)) {
                continue;
            }
            const gp_XYZ offset = nearest.XYZ () - center.XYZ ();
            const gp_XYZ radialVector = radialFromCenter
                ? gp_XYZ (offset)
                : gp_XYZ (offset - axisDirection * offset.Dot (axisDirection));
            if (radialVector.Modulus () <= Precision::Confusion ()) {
                continue;
            }
            dotSum += outward.XYZ ().Dot (radialVector / radialVector.Modulus ());
            samples++;
        }
        if (samples == 0) {
            return "unknown";
        }
        const Standard_Real mean =
            dotSum / static_cast<Standard_Real> (samples);
        if (mean > 0.05) {
            return "convex";
        }
        if (mean < -0.05) {
            return "concave";
        }
        return "unknown";
    } catch (const Standard_Failure&) {
        return "unknown";
    }
}

/**
 * Exact analytic parameters of the face's underlying surface primitive. Only
 * the single key matching the analytic type is present (plane / cylinder /
 * cone / sphere / torus); synthetic surfaces produce no `analytic`.
 */
emscripten::val BuildAnalyticSurface (const TopoDS_Face& face)
{
    emscripten::val analytic (emscripten::val::object ());
    try {
        BRepAdaptor_Surface surface (face, false);
        switch (surface.GetType ()) {
            case GeomAbs_Plane: {
                const gp_Pln& plane = surface.Plane ();
                emscripten::val params (emscripten::val::object ());
                emscripten::val normalValue (emscripten::val::array ());
                emscripten::val pointValue (emscripten::val::array ());
                WriteDirection (normalValue, plane.Axis ().Direction ());
                WritePoint (pointValue, plane.Location ());
                params.set ("normal", normalValue);
                params.set ("point", pointValue);
                analytic.set ("plane", params);
                break;
            }
            case GeomAbs_Cylinder: {
                const gp_Cylinder cylinder = surface.Cylinder ();
                emscripten::val params (emscripten::val::object ());
                emscripten::val axisValue (emscripten::val::array ());
                emscripten::val centerValue (emscripten::val::array ());
                WriteDirection (axisValue, cylinder.Axis ().Direction ());
                WritePoint (centerValue, cylinder.Location ());
                params.set ("axis", axisValue);
                params.set ("center", centerValue);
                params.set ("radius", cylinder.Radius ());
                analytic.set ("cylinder", params);
                break;
            }
            case GeomAbs_Cone: {
                const gp_Cone& cone = surface.Cone ();
                emscripten::val params (emscripten::val::object ());
                emscripten::val axisValue (emscripten::val::array ());
                emscripten::val apexValue (emscripten::val::array ());
                WriteDirection (axisValue, cone.Axis ().Direction ());
                WritePoint (apexValue, cone.Apex ());
                params.set ("axis", axisValue);
                params.set ("apex", apexValue);
                params.set ("semiAngleDeg", cone.SemiAngle () * 180.0 / M_PI);
                params.set ("radius", cone.RefRadius ());
                analytic.set ("cone", params);
                break;
            }
            case GeomAbs_Sphere: {
                const gp_Sphere& sphere = surface.Sphere ();
                emscripten::val params (emscripten::val::object ());
                emscripten::val centerValue (emscripten::val::array ());
                WritePoint (centerValue, sphere.Location ());
                params.set ("center", centerValue);
                params.set ("radius", sphere.Radius ());
                analytic.set ("sphere", params);
                break;
            }
            case GeomAbs_Torus: {
                const gp_Torus& torus = surface.Torus ();
                emscripten::val params (emscripten::val::object ());
                emscripten::val centerValue (emscripten::val::array ());
                emscripten::val axisValue (emscripten::val::array ());
                WritePoint (centerValue, torus.Location ());
                WriteDirection (axisValue, torus.Axis ().Direction ());
                params.set ("center", centerValue);
                params.set ("axis", axisValue);
                params.set ("majorRadius", torus.MajorRadius ());
                params.set ("minorRadius", torus.MinorRadius ());
                analytic.set ("torus", params);
                break;
            }
            default:
                break;
        }
    } catch (const Standard_Failure&) {
    }
    return analytic;
}

/**
 * Midpoint of the edge's 3D curve (parametric midpoint; falls back to the
 * average of the discretized points when the curve parameters are infinite).
 */
gp_Pnt EdgeMidpoint (
    const TopoDS_Edge& edge,
    const std::vector<gp_Pnt>& discretized
)
{
    try {
        BRepAdaptor_Curve curve (edge);
        const Standard_Real firstParameter = curve.FirstParameter ();
        const Standard_Real lastParameter = curve.LastParameter ();
        if (!Precision::IsInfinite (firstParameter) &&
            !Precision::IsInfinite (lastParameter)) {
            return curve.Value ((firstParameter + lastParameter) * 0.5);
        }
    } catch (const Standard_Failure&) {
    }
    if (discretized.empty ()) {
        return gp_Pnt (0.0, 0.0, 0.0);
    }
    gp_XYZ sum;
    for (std::size_t pointIndex = 0; pointIndex < discretized.size (); pointIndex++) {
        sum += discretized[pointIndex].XYZ ();
    }
    return gp_Pnt (sum / static_cast<Standard_Real> (discretized.size ()));
}

/**
 * Outward unit normal of `face` at the edge midpoint. Uses the edge's pcurve
 * on the face (exact surface parameter at the curve midpoint) and falls back
 * to projecting the 3D midpoint onto the face surface.
 */
bool EdgeMidpointFaceNormal (
    const TopoDS_Edge& edge,
    const TopoDS_Face& face,
    const gp_Pnt& midpoint,
    gp_Dir& normal
)
{
    try {
        Handle(Geom2d_Curve) pcurve;
        Standard_Real firstParameter;
        Standard_Real lastParameter;
        pcurve = BRep_Tool::CurveOnSurface (
            edge,
            face,
            firstParameter,
            lastParameter
        );
        if (!pcurve.IsNull () &&
            !Precision::IsInfinite (firstParameter) &&
            !Precision::IsInfinite (lastParameter)) {
            const gp_Pnt2d uv = pcurve->Value ((firstParameter + lastParameter) * 0.5);
            return OutwardNormalAt (face, uv.X (), uv.Y (), normal);
        }
    } catch (const Standard_Failure&) {
    }
    const Handle(Geom_Surface)& surface = BRep_Tool::Surface (face);
    gp_Pnt nearest;
    Standard_Real u, v;
    if (!NearestSurfacePoint (surface, midpoint, nearest, u, v)) {
        return false;
    }
    return OutwardNormalAt (face, u, v, normal);
}

}

void WriteNativeTopology (
    const TopoDS_Shape& shape,
    emscripten::val& meshObject,
    const ImportParams& params
)
{
    TopTools_IndexedMapOfShape faceMap;
    TopTools_IndexedMapOfShape edgeMap;
    TopTools_IndexedMapOfShape vertexMap;
    TopExp::MapShapes (shape, TopAbs_FACE, faceMap);
    TopExp::MapShapes (shape, TopAbs_EDGE, edgeMap);
    TopExp::MapShapes (shape, TopAbs_VERTEX, vertexMap);

    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors (shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

    std::map<Standard_Integer, double> faceDiagonalByIndex;
    std::map<Standard_Integer, gp_Pnt> faceCentroidPointByIndex;
    std::map<Standard_Integer, gp_Dir> faceCentroidNormalByIndex;

    emscripten::val faceDescriptors (emscripten::val::array ());
    for (Standard_Integer faceIndex = 1; faceIndex <= faceMap.Extent (); faceIndex++) {
        const TopoDS_Face& face = TopoDS::Face (faceMap.FindKey (faceIndex));
        emscripten::val faceObject (emscripten::val::object ());
        faceObject.set ("index", faceIndex - 1);

        std::string surfaceType = "other";
        try {
            BRepAdaptor_Surface surface (face, true);
            surfaceType = GetSurfaceTypeName (surface.GetType ());
        } catch (const Standard_Failure&) {
        }
        faceObject.set ("surface_type", surfaceType);

        gp_Pnt centroid = gp_Pnt (0.0, 0.0, 0.0);
        try {
            GProp_GProps properties;
            BRepGProp::SurfaceProperties (face, properties);
            centroid = properties.CentreOfMass ();
            faceObject.set ("area", properties.Mass ());
            emscripten::val centroidValue (emscripten::val::array ());
            WritePoint (centroidValue, centroid);
            faceObject.set ("centroid", centroidValue);
        } catch (const Standard_Failure&) {
        }

        try {
            Bnd_Box bounds;
            BRepBndLib::Add (face, bounds, false);
            emscripten::val boundsValues (emscripten::val::array ());
            WriteBounds (boundsValues, bounds);
            faceObject.set ("bounds", boundsValues);
            if (!bounds.IsVoid ()) {
                Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
                bounds.Get (xMin, yMin, zMin, xMax, yMax, zMax);
                const gp_XYZ extents (
                    xMax - xMin,
                    yMax - yMin,
                    zMax - zMin
                );
                const double diagonal = std::sqrt (
                    extents.Dot (extents)
                );
                if (diagonal > Precision::Confusion ()) {
                    faceDiagonalByIndex[faceIndex] = diagonal;
                }
            }
        } catch (const Standard_Failure&) {
        }

        // Kernel graph attributes.
        faceObject.set ("convexity", FaceConvexityLabel (face));

        const Handle(Geom_Surface)& faceSurface = BRep_Tool::Surface (face);
        gp_Pnt nearestCentroidPoint;
        Standard_Real centroidU, centroidV;
        if (NearestSurfacePoint (
                faceSurface,
                centroid,
                nearestCentroidPoint,
                centroidU,
                centroidV
            )) {
            emscripten::val centroidPointValue (emscripten::val::array ());
            WritePoint (centroidPointValue, nearestCentroidPoint);
            faceObject.set ("centroid_point", centroidPointValue);
            faceCentroidPointByIndex[faceIndex] = nearestCentroidPoint;

            gp_Dir centroidNormal;
            if (OutwardNormalAt (face, centroidU, centroidV, centroidNormal)) {
                emscripten::val centroidNormalValue (emscripten::val::array ());
                WriteDirection (centroidNormalValue, centroidNormal);
                faceObject.set ("centroid_normal", centroidNormalValue);
                faceCentroidNormalByIndex[faceIndex] = centroidNormal;
            }
        }

        // Exact analytic surface parameters (empty object for synthetic
        // surfaces such as B-splines).
        faceObject.set ("analytic", BuildAnalyticSurface (face));

        faceDescriptors.set (faceIndex - 1, faceObject);
    }

    emscripten::val vertices (emscripten::val::array ());
    for (Standard_Integer vertexIndex = 1; vertexIndex <= vertexMap.Extent (); vertexIndex++) {
        const TopoDS_Vertex& vertex = TopoDS::Vertex (vertexMap.FindKey (vertexIndex));
        emscripten::val vertexObject (emscripten::val::object ());
        emscripten::val position (emscripten::val::array ());
        WritePoint (position, BRep_Tool::Pnt (vertex));
        vertexObject.set ("index", vertexIndex - 1);
        vertexObject.set ("position", position);
        vertices.set (vertexIndex - 1, vertexObject);
    }

    const double linearDeflection = GetLinearDeflection (shape, params);
    const double angularDeflection = std::max (params.angularDeflection, 1.0e-4);
    std::map<Standard_Integer, Standard_Integer> outputEdgeIndexByShapeIndex;
    emscripten::val edges (emscripten::val::array ());
    Standard_Integer outputEdgeIndex = 0;

    for (Standard_Integer shapeEdgeIndex = 1;
         shapeEdgeIndex <= edgeMap.Extent ();
         shapeEdgeIndex++) {
        const TopoDS_Edge& edge = TopoDS::Edge (edgeMap.FindKey (shapeEdgeIndex));
        const std::vector<gp_Pnt> points =
            DiscretizeEdge (edge, linearDeflection, angularDeflection);
        if (points.size () < 2 || !HasDrawableSegment (points)) {
            continue;
        }

        emscripten::val edgeObject (emscripten::val::object ());
        emscripten::val positions (emscripten::val::array ());
        Standard_Integer coordinateIndex = 0;
        for (std::size_t pointIndex = 0; pointIndex + 1 < points.size (); pointIndex++) {
            const gp_Pnt endpoints[2] = { points[pointIndex], points[pointIndex + 1] };
            for (Standard_Integer endpointIndex = 0; endpointIndex < 2; endpointIndex++) {
                positions.set (coordinateIndex++, endpoints[endpointIndex].X ());
                positions.set (coordinateIndex++, endpoints[endpointIndex].Y ());
                positions.set (coordinateIndex++, endpoints[endpointIndex].Z ());
            }
        }

        std::vector<Standard_Integer> writtenFaceIndices;
        std::set<Standard_Integer> seenFaceIndices;
        if (edgeFaces.Contains (edge)) {
            const TopTools_ListOfShape& owningFaces = edgeFaces.FindFromKey (edge);
            for (TopTools_ListIteratorOfListOfShape iterator (owningFaces);
                 iterator.More ();
                 iterator.Next ()) {
                const Standard_Integer faceIndex = faceMap.FindIndex (iterator.Value ()) - 1;
                if (faceIndex >= 0 && seenFaceIndices.insert (faceIndex).second) {
                    writtenFaceIndices.push_back (faceIndex);
                }
            }
        }

        emscripten::val faceIndices (emscripten::val::array ());
        for (std::size_t faceIndex = 0; faceIndex < writtenFaceIndices.size (); faceIndex++) {
            faceIndices.set (faceIndex, writtenFaceIndices[faceIndex]);
        }

        emscripten::val vertexIndices (emscripten::val::array ());
        TopoDS_Vertex firstVertex;
        TopoDS_Vertex lastVertex;
        TopExp::Vertices (edge, firstVertex, lastVertex);
        Standard_Integer vertexOutputIndex = 0;
        if (!firstVertex.IsNull ()) {
            const Standard_Integer vertexIndex = vertexMap.FindIndex (firstVertex) - 1;
            if (vertexIndex >= 0) {
                vertexIndices.set (vertexOutputIndex++, vertexIndex);
            }
        }
        if (!lastVertex.IsNull () &&
            (firstVertex.IsNull () || !lastVertex.IsSame (firstVertex))) {
            const Standard_Integer vertexIndex = vertexMap.FindIndex (lastVertex) - 1;
            if (vertexIndex >= 0) {
                vertexIndices.set (vertexOutputIndex++, vertexIndex);
            }
        }

        std::string curveType = "other";
        Standard_Real curveLength = 0.0;
        emscripten::val signaturePoints (emscripten::val::array ());
        try {
            BRepAdaptor_Curve curve (edge);
            curveType = GetCurveTypeName (curve.GetType ());
            const Standard_Real firstParameter = curve.FirstParameter ();
            const Standard_Real lastParameter = curve.LastParameter ();
            if (!Precision::IsInfinite (firstParameter) &&
                !Precision::IsInfinite (lastParameter)) {
                curveLength = GCPnts_AbscissaPoint::Length (
                    curve,
                    firstParameter,
                    lastParameter
                );
                for (Standard_Integer sampleIndex = 0; sampleIndex < 5; sampleIndex++) {
                    const Standard_Real ratio =
                        static_cast<Standard_Real> (sampleIndex) / 4.0;
                    const Standard_Real parameter =
                        firstParameter + (lastParameter - firstParameter) * ratio;
                    gp_Pnt point;
                    curve.D0 (parameter, point);
                    emscripten::val pointValue (emscripten::val::array ());
                    WritePoint (pointValue, point);
                    signaturePoints.set (sampleIndex, pointValue);
                }
            }
        } catch (const Standard_Failure&) {
        }

        // Kernel graph attributes for the exporter.
        const gp_Pnt midpoint = EdgeMidpoint (edge, points);
        emscripten::val midpointValue (emscripten::val::array ());
        WritePoint (midpointValue, midpoint);
        edgeObject.set ("midpoint", midpointValue);

        struct IncidentFaceNormal
        {
            Standard_Integer faceIndex;
            gp_Dir normal;
        };
        std::vector<IncidentFaceNormal> incidentNormals;
        for (std::size_t faceIndex = 0; faceIndex < writtenFaceIndices.size (); faceIndex++) {
            const Standard_Integer localFaceIndex = writtenFaceIndices[faceIndex];
            const TopoDS_Face& face = TopoDS::Face (faceMap.FindKey (localFaceIndex + 1));
            gp_Dir outward;
            if (EdgeMidpointFaceNormal (edge, face, midpoint, outward)) {
                incidentNormals.push_back ({ localFaceIndex, outward });
            }
        }

        emscripten::val normalsValue (emscripten::val::array ());
        for (std::size_t faceIndex = 0; faceIndex < writtenFaceIndices.size (); faceIndex++) {
            const Standard_Integer localFaceIndex = writtenFaceIndices[faceIndex];
            Standard_Integer normalMatch = -1;
            for (std::size_t candidate = 0; candidate < incidentNormals.size (); candidate++) {
                if (incidentNormals[candidate].faceIndex == localFaceIndex) {
                    normalMatch = static_cast<Standard_Integer> (candidate);
                    break;
                }
            }
            if (normalMatch >= 0) {
                emscripten::val normalValue (emscripten::val::array ());
                WriteDirection (normalValue, incidentNormals[normalMatch].normal);
                normalsValue.set (faceIndex, normalValue);
            } else {
                normalsValue.set (faceIndex, emscripten::val::null ());
            }
        }
        edgeObject.set ("normals", normalsValue);

        emscripten::val contacts (emscripten::val::array ());
        Standard_Integer contactIndex = 0;
        for (std::size_t i = 0; i + 1 < incidentNormals.size (); i++) {
            const IncidentFaceNormal& first = incidentNormals[i];
            for (std::size_t j = i + 1; j < incidentNormals.size (); j++) {
                const IncidentFaceNormal& second = incidentNormals[j];

                // Face 1 is the lexicographically-smaller BRepFace id so the
                // classification matches the exporter's sorted face-pair order.
                bool faceOneIsFirst = first.faceIndex < second.faceIndex;
                const gp_Dir& n1 =
                    faceOneIsFirst ? first.normal : second.normal;
                const gp_Dir& n2 =
                    faceOneIsFirst ? second.normal : first.normal;
                const Standard_Integer faceOneIndex =
                    faceOneIsFirst ? first.faceIndex : second.faceIndex;
                const Standard_Integer faceTwoIndex =
                    faceOneIsFirst ? second.faceIndex : first.faceIndex;

                const auto centroidPointIt =
                    faceCentroidPointByIndex.find (faceOneIndex + 1);
                const auto centroidNormalIt =
                    faceCentroidNormalByIndex.find (faceOneIndex + 1);
                const auto diagonalIt =
                    faceDiagonalByIndex.find (faceOneIndex + 1);
                if (centroidPointIt == faceCentroidPointByIndex.end () ||
                    centroidNormalIt == faceCentroidNormalByIndex.end () ||
                    diagonalIt == faceDiagonalByIndex.end ()) {
                    continue;
                }

                const double gamma = acos (std::max (-1.0, std::min (1.0, n1.Dot (n2))));
                const double tau = std::max (1.0e-7, diagonalIt->second * 1.0e-3);
                const gp_XYZ probe =
                    centroidPointIt->second.XYZ () -
                    centroidNormalIt->second.XYZ () * tau;
                const double side = (probe - midpoint.XYZ ()).Dot (n2.XYZ ());
                const bool convex = side < 0.0;
                const double dihedralDeg =
                    (convex ? M_PI - gamma : M_PI + gamma) * 180.0 / M_PI;

                emscripten::val contact (emscripten::val::object ());
                contact.set ("face_i", faceOneIndex);
                contact.set ("face_j", faceTwoIndex);
                contact.set ("convexity", convex ? "convex" : "concave");
                contact.set ("dihedral_deg", dihedralDeg);
                contacts.set (contactIndex++, contact);
            }
        }
        edgeObject.set ("contacts", contacts);

        edgeObject.set ("index", outputEdgeIndex);
        edgeObject.set ("positions", positions);
        edgeObject.set ("face_indices", faceIndices);
        edgeObject.set ("vertex_indices", vertexIndices);
        edgeObject.set ("curve_type", curveType);
        edgeObject.set ("curve_length", curveLength);
        edgeObject.set ("signature_points", signaturePoints);
        edgeObject.set ("closed", edge.Closed ());
        edges.set (outputEdgeIndex, edgeObject);
        outputEdgeIndexByShapeIndex[shapeEdgeIndex] = outputEdgeIndex;
        outputEdgeIndex++;
    }

    emscripten::val loops (emscripten::val::array ());
    Standard_Integer loopIndex = 0;
    for (Standard_Integer faceIndex = 1; faceIndex <= faceMap.Extent (); faceIndex++) {
        const TopoDS_Face& face = TopoDS::Face (faceMap.FindKey (faceIndex));
        for (TopExp_Explorer wireExplorer (face, TopAbs_WIRE);
             wireExplorer.More ();
             wireExplorer.Next ()) {
            const TopoDS_Wire& wire = TopoDS::Wire (wireExplorer.Current ());
            emscripten::val edgeIndices (emscripten::val::array ());
            Standard_Integer wireEdgeIndex = 0;
            for (BRepTools_WireExplorer edgeExplorer (wire, face);
                 edgeExplorer.More ();
                 edgeExplorer.Next ()) {
                const Standard_Integer shapeEdgeIndex =
                    edgeMap.FindIndex (edgeExplorer.Current ());
                const auto outputEdge = outputEdgeIndexByShapeIndex.find (shapeEdgeIndex);
                if (outputEdge != outputEdgeIndexByShapeIndex.end ()) {
                    edgeIndices.set (wireEdgeIndex++, outputEdge->second);
                }
            }

            emscripten::val loopObject (emscripten::val::object ());
            loopObject.set ("index", loopIndex);
            loopObject.set ("face_index", faceIndex - 1);
            loopObject.set ("edge_indices", edgeIndices);
            loops.set (loopIndex++, loopObject);
        }
    }

    meshObject.set ("brep_vertices", vertices);
    meshObject.set ("brep_edges", edges);
    meshObject.set ("brep_loops", loops);
    meshObject.set ("brep_face_descriptors", faceDescriptors);
    meshObject.set ("topology_source", "occt");
}

#endif