var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT) || 3e3;
app.use(import_express.default.json());
var aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is not set. Please set it in Settings > Secrets.");
    }
    aiClient = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build"
        }
      }
    });
  }
  return aiClient;
}
app.post("/api/analyze-spec", async (req, res) => {
  try {
    const { specText, family } = req.body;
    if (!specText) {
      return res.status(400).json({ error: "No specification text provided." });
    }
    const ai = getGeminiClient();
    const prompt = `
You are an expert Maxillofacial Implant Quality Assurance RAG Agent.
Analyze the following custom engineering specification text or drawing notes for a "${family || "Maxillofacial Reconstruction"}" implant device family.
Extract machine-checkable geometric, assembly, and documentation rules.

Return a structured list of rules, following this exact output schema:
{
  "rules": [
    {
      "id": "unique-slug-id",
      "name": "Human readable rule name",
      "category": "geometry" | "assembly" | "documentation" | "bom",
      "description": "Specific check instructions detailed from the specifications",
      "targetFeature": "plate_thickness" | "hole_diameter" | "hole_count" | "edge_distance" | "material" | "part_number" | "components" | "screw_compatibility" | "manufacturing_notes",
      "metric": "mm" | "count" | "string" | "boolean",
      "operator": "min" | "max" | "exact" | "contains" | "match",
      "thresholdValue": "numeric or text representing the limit, e.g., 0.8, 2.0, Ti-6Al-4V, true",
      "severity": "minor" | "major" | "critical"
    }
  ]
}

Specification Text:
"""
${specText}
"""
    `;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            rules: {
              type: import_genai.Type.ARRAY,
              description: "List of compliance rules extracted from the notes",
              items: {
                type: import_genai.Type.OBJECT,
                properties: {
                  id: { type: import_genai.Type.STRING },
                  name: { type: import_genai.Type.STRING },
                  category: { type: import_genai.Type.STRING },
                  description: { type: import_genai.Type.STRING },
                  targetFeature: { type: import_genai.Type.STRING },
                  metric: { type: import_genai.Type.STRING },
                  operator: { type: import_genai.Type.STRING },
                  thresholdValue: { type: import_genai.Type.STRING },
                  severity: { type: import_genai.Type.STRING }
                },
                required: ["id", "name", "category", "description", "targetFeature", "operator", "thresholdValue", "severity"]
              }
            }
          },
          required: ["rules"]
        }
      }
    });
    const parsedData = JSON.parse(response.text || "{}");
    res.json(parsedData);
  } catch (error) {
    console.error("Error analyzing drawing specifications:", error);
    res.status(500).json({ error: error.message || "Failed to analyze specifications text using AI." });
  }
});
app.post("/api/generate-recommendations", async (req, res) => {
  try {
    const { failingChecks, implantPackage } = req.body;
    const ai = getGeminiClient();
    const prompt = `
You are a Lead Maxillofacial Biomedical Design Engineer.
A surgical implant CAD package has failed several geometric or documentation compliance checks. Understand the structural risks and generate actionable recommendations to modify the CAD model configuration without using F360, doing so inside our in-browser solid modeling checker environment.

Failing Checks:
${JSON.stringify(failingChecks, null, 2)}

Implant package metadata:
- Family: ${implantPackage?.family || "Mandibular"}
- Plate Design Thickness: ${implantPackage?.drawing?.thickness || "unknown"} mm
- Assembly Component Count: ${implantPackage?.assembly?.screws?.length || 0} locking screws
- Primary Material: ${implantPackage?.drawing?.material || "unknown"}

Provide:
1. Medical/Clinical Risk Analysis (e.g., too thin could lead to stress fractures under masticatory loads, wrong screw family compatibility could fail in surgery).
2. Actionable CAD Revision Steps (e.g., increase thickness along biomechanical loading lines, reposition screw holes to meet boundary clearance rules, verify material code matching Ti-6Al-4V).
3. Surgical Alignment Advice (e.g., ensuring appropriate bone contact, profile height minimizes soft tissue irritation).

Provide the output in clean, highly professional human-readable markdown format with clear headings. Keep the advice tailored specifically to Maxillofacial implants and solid modeling rules.
    `;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt
    });
    res.json({ recommendations: response.text });
  } catch (error) {
    console.error("Error generating compliance recommendations:", error);
    res.status(500).json({ error: error.message || "Failed to generate AI clinical design recommendations." });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite development middleware...");
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static production assets...");
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Maxillofacial CAD Verification server booted successfully at http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
