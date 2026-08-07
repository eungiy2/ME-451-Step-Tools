#ifdef EMSCRIPTEN

#include "native-topology-export.hpp"

#include <algorithm>
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
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
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

        try {
            GProp_GProps properties;
            BRepGProp::SurfaceProperties (face, properties);
            faceObject.set ("area", properties.Mass ());
            emscripten::val centroid (emscripten::val::array ());
            WritePoint (centroid, properties.CentreOfMass ());
            faceObject.set ("centroid", centroid);
        } catch (const Standard_Failure&) {
        }

        try {
            Bnd_Box bounds;
            BRepBndLib::Add (face, bounds, false);
            emscripten::val boundsValues (emscripten::val::array ());
            WriteBounds (boundsValues, bounds);
            faceObject.set ("bounds", boundsValues);
        } catch (const Standard_Failure&) {
        }
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

        emscripten::val faceIndices (emscripten::val::array ());
        std::set<Standard_Integer> writtenFaceIndices;
        Standard_Integer faceOutputIndex = 0;
        if (edgeFaces.Contains (edge)) {
            const TopTools_ListOfShape& owningFaces = edgeFaces.FindFromKey (edge);
            for (TopTools_ListIteratorOfListOfShape iterator (owningFaces);
                 iterator.More ();
                 iterator.Next ()) {
                const Standard_Integer faceIndex = faceMap.FindIndex (iterator.Value ()) - 1;
                if (faceIndex >= 0 && writtenFaceIndices.insert (faceIndex).second) {
                    faceIndices.set (faceOutputIndex++, faceIndex);
                }
            }
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
