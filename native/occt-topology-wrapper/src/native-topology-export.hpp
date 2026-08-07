#pragma once

#ifdef EMSCRIPTEN

#include "importer.hpp"

#include <TopoDS_Shape.hxx>
#include <emscripten/val.h>

void WriteNativeTopology (
    const TopoDS_Shape& shape,
    emscripten::val& meshObject,
    const ImportParams& params
);

#endif
