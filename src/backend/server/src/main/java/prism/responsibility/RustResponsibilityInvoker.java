package prism.responsibility;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Adapter for the bw-responsibility tool (Rust-based actor responsibility computation).
 * Invokes the external binary and parses its output into ResponsibilityOutput format.
 * 
 * @see <a href="https://zenodo.org/records/13738447">Actor-Based Responsibility Tool</a>
 */
public class RustResponsibilityInvoker {

    private static final Logger logger = LoggerFactory.getLogger(RustResponsibilityInvoker.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final String binaryPath;

    public RustResponsibilityInvoker(String binaryPath) {
        this.binaryPath = binaryPath;
    }

    /**
     * Execute the external tool and parse the result.
     * @param modelFile PRISM model path
     * @param property (ignored for current Rust tool; responsibility is driven by -b bad label)
     * @param mode optimistic|pessimistic (maps to -v o | -v p)
     * @param index shapley|banzhaf|count (maps to -m)
     * @param level refinement level (>0 enables refinement engine via -a)
     * @param overrideTrace optional explicit counterexample trace (requires -c support if implemented)
     * @return ResponsibilityOutput mapped from tool output
     * @throws Exception on execution or parsing errors
     */
    public ResponsibilityOutput run(String modelFile,
                                     String property,
                                     String mode,
                                     String index,
                                     int level,
                                     List<String> overrideTrace) throws Exception {
        long start = System.currentTimeMillis();
        
        // Convert model file to absolute path to avoid issues with working directory
        Path modelPath = java.nio.file.Paths.get(modelFile).toAbsolutePath();
        if (!Files.exists(modelPath)) {
            throw new Exception("Model file does not exist: " + modelPath);
        }
        String absoluteModelFile = modelPath.toString();
        
        Path workDir = Files.createTempDirectory("resp_tool_");
        Path outFile = workDir.resolve("responsibility.json");
        Path altFile = workDir.resolve("responsibility.txt");

        List<String> cmd = buildCommand(absoluteModelFile, property, mode, index, level, outFile, altFile, overrideTrace);
        logger.info("Invoking responsibility tool: {}", String.join(" ", cmd));

        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.directory(workDir.toFile());
        pb.redirectErrorStream(true); // merge stdout+stderr for easier capture
        
        // Add PRISM to PATH for the Rust tool
        Map<String, String> env = pb.environment();
        String prismBin = System.getenv().getOrDefault("PRISM_BIN", "/Users/aldo/opt/prism-source/prism/bin/prism");
        env.put("PRISM_BIN", prismBin);
        // Also add PRISM bin directory to PATH
        String prismBinDir = prismBin.substring(0, prismBin.lastIndexOf('/'));
        String currentPath = env.getOrDefault("PATH", "");
        env.put("PATH", prismBinDir + ":" + currentPath);
        
        Process proc;
        try {
            proc = pb.start();
        } catch (IOException ioe) {
            throw new Exception("Failed to start responsibility tool: " + ioe.getMessage(), ioe);
        }

        // Capture output (for diagnostics – JSON may also go to file)
        StringBuilder console = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                console.append(line).append('\n');
            }
        }
        int code = proc.waitFor();
        logger.info("Responsibility tool exited with code {}. Output ({} bytes):\n{}", code, console.length(), console);
        if (code != 0) {
            logger.error("Responsibility tool FAILED with code {}. Output:\n{}", code, console);
            throw new Exception("Responsibility tool failed (exit=" + code + ")");
        }

        // Extract state names from PRISM model FIRST for mapping during parsing
        Map<String, String> stateNames = new LinkedHashMap<>();
        try {
            stateNames = extractStateNamesFromModel(modelFile);
            logger.info("Extracted {} state names from PRISM model", stateNames.size());
        } catch (Exception e) {
            logger.warn("Could not extract state names from model: {}", e.getMessage());
        }

        ResponsibilityOutput output = parsePreferred(outFile, altFile, console.toString(), stateNames);
        output.setLevel(level);
        output.setResponsibilityType(mode);
        output.setPowerIndex(index);
        output.setCounterexample(overrideTrace); // only set if provided
        output.setApproximate(Boolean.FALSE); // exact computation
        output.setGroupedMode(Boolean.FALSE); // will update after inspecting tool grouping output
        output.setStateMetadata(enrichStateMetadata(output.getStateResponsibility(), overrideTrace));
        output.setStateIdToName(stateNames);

        long ms = System.currentTimeMillis() - start;
        logger.info("Responsibility tool completed in {} ms: states={}, components={}", ms,
                output.getStateResponsibility() != null ? output.getStateResponsibility().size() : 0,
                output.getComponentResponsibility() != null ? output.getComponentResponsibility().size() : 0);

        // Clean up temp dir lazily (keep if DEBUG env set)
        if (System.getenv("RESP_TOOL_DEBUG") == null) {
            safeDelete(workDir);
        } else {
            logger.info("Keeping temp directory for inspection: {}", workDir);
        }
        return output;
    }

    private List<String> buildCommand(String modelFile,
                                      String property,
                                      String mode,
                                      String index,
                                      int level,
                                      Path outFile,
                                      Path altFile,
                                      List<String> overrideTrace) {
        List<String> cmd = new ArrayList<>();
        cmd.add(binaryPath);
        // Real CLI flags (captured from tool --help)
        // -p prism model, -b bad label, -m metric, -g grouped mode, -v responsibility version, -f output file
        cmd.add("-p");
        cmd.add(modelFile);

        // Bad label: must be present in the model; allow override via env RESP_BAD_LABEL (default: "error")
        String badLabel = System.getenv().getOrDefault("RESP_BAD_LABEL", "error");
        cmd.add("-b");
        cmd.add(badLabel);

        // Metric (index)
        String metric = (index == null || index.isBlank()) ? "shapley" : index.toLowerCase();
        logger.info("→ Rust command metric flag: -m {} (from index='{}')", metric, index);
        cmd.add("-m");
        cmd.add(metric);

        // Grouping mode (default individual); env RESP_GROUPING overrides
        String grouping = System.getenv().getOrDefault("RESP_GROUPING", "individual");
        cmd.add("-g");
        cmd.add(grouping);

        // Responsibility version (-v o | -v p)
        String version = "p"; // pessimistic default per help text
        if (mode != null) {
            if (mode.toLowerCase().startsWith("o")) version = "o"; // optimistic
            else if (mode.toLowerCase().startsWith("p")) version = "p"; // pessimistic
        }
        logger.info("→ Rust command version flag: -v {} (from mode='{}')", version, mode);
        cmd.add("-v");
        cmd.add(version);

        // Refinement: enable -a if level > 0 (simple heuristic mapping)
        // NOTE: Refinement mode currently ignores the -m parameter and always uses Shapley
        // So we disable refinement when using Banzhaf until the tool is fixed
        if (level > 0 && !"banzhaf".equalsIgnoreCase(metric)) {
            cmd.add("-a");
        }

        // Thread count override (optional) via RESP_THREADS
        String threads = System.getenv("RESP_THREADS");
        if (threads != null && !threads.isBlank()) {
            cmd.add("-j");
            cmd.add(threads.trim());
        }

        // Output file (JSON or plain text produced by tool; we expect numeric lines or a simple format)
        cmd.add("-f");
        cmd.add(outFile.toString());

        // Optional: pass explicit PRISM path and Java home if provided via env
        String prismPath = System.getenv("RESP_PRISM_PATH");
        if (prismPath != null && !prismPath.isBlank()) {
            cmd.add("--prism-path");
            cmd.add(prismPath.trim());
        }
        String prismJava = System.getenv("RESP_PRISM_JAVA");
        if (prismJava != null && !prismJava.isBlank()) {
            cmd.add("--prism-java");
            cmd.add(prismJava.trim());
        }

        // Counterexample trace (requires -c file); supply if overrideTrace given
        if (overrideTrace != null && !overrideTrace.isEmpty()) {
            try {
                Path traceFile = Files.createTempFile("trace_", ".ce");
                Files.write(traceFile, overrideTrace, StandardCharsets.UTF_8);
                cmd.add("-c");
                cmd.add(traceFile.toString());
            } catch (IOException e) {
                logger.warn("Failed to create temporary trace file: {}", e.getMessage());
            }
        }

        return cmd;
    }

    private ResponsibilityOutput parsePreferred(Path jsonFile, Path txtFile, String console, Map<String, String> stateNames) throws Exception {
        if (Files.exists(jsonFile)) {
            try {
                byte[] data = Files.readAllBytes(jsonFile);
                JsonNode root = mapper.readTree(data);
                return parseJson(root);
            } catch (Exception e) {
                logger.warn("JSON parse failed ({}). Falling back to line parse from same file.", e.getMessage());
                // JSON parsing failed, but the file might be in text format - try parsing it as text
                try (BufferedReader br = new BufferedReader(new FileReader(jsonFile.toFile(), StandardCharsets.UTF_8))) {
                    java.util.List<String> lines = new java.util.ArrayList<>();
                    br.lines().forEach(lines::add);
                    logger.info("Parsing responsibility from file (text format): {} ({} lines)", jsonFile, lines.size());
                    Map<String, Double> stateResp = parseLineFormat(lines, stateNames);
                    ResponsibilityOutput o = new ResponsibilityOutput();
                    o.setStateResponsibility(stateResp);
                    o.setComponentResponsibility(Collections.emptyMap());
                    return o;
                }
            }
        }
        if (Files.exists(txtFile)) {
            logger.info("Reading responsibility from file: {}", txtFile);
            try (BufferedReader br = new BufferedReader(new FileReader(txtFile.toFile(), StandardCharsets.UTF_8))) {
                java.util.List<String> lines = new java.util.ArrayList<>();
                br.lines().forEach(lines::add); // Java 11 compatible
                Map<String, Double> stateResp = parseLineFormat(lines, stateNames);
                ResponsibilityOutput o = new ResponsibilityOutput();
                o.setStateResponsibility(stateResp);
                o.setComponentResponsibility(Collections.emptyMap());
                return o;
            }
        }
        // Attempt parse from console stdout if no files
        logger.warn("No output files found, parsing from console output (may contain stderr contamination)");
        Map<String, Double> stateResp = parseLineFormat(Arrays.asList(console.split("\n")), stateNames);
        ResponsibilityOutput o = new ResponsibilityOutput();
        o.setStateResponsibility(stateResp);
        o.setComponentResponsibility(Collections.emptyMap());
        return o;
    }

    private ResponsibilityOutput parseJson(JsonNode root) {
        ResponsibilityOutput out = new ResponsibilityOutput();
        // Try flexible extraction: look for common keys
        Map<String, Double> stateResp = new LinkedHashMap<>();
        if (root.has("states")) {
            // states: { id: value, ... }
            JsonNode statesNode = root.get("states");
            statesNode.fieldNames().forEachRemaining(fn -> {
                JsonNode v = statesNode.get(fn);
                if (v != null && v.isNumber()) {
                    stateResp.put(fn, v.doubleValue());
                }
            });
        } else if (root.has("stateResponsibility")) {
            JsonNode statesNode = root.get("stateResponsibility");
            statesNode.fieldNames().forEachRemaining(fn -> {
                JsonNode v = statesNode.get(fn);
                if (v != null && v.isNumber()) {
                    stateResp.put(fn, v.doubleValue());
                }
            });
        } else if (root.has("states") && root.get("states").isArray()) {
            for (JsonNode s : root.get("states")) {
                if (s.has("id") && s.has("responsibility")) {
                    stateResp.put(s.get("id").asText(), s.get("responsibility").asDouble());
                }
            }
        }
        out.setStateResponsibility(stateResp);

        // Component responsibility (if provided)
        Map<String, Double> componentResp = new LinkedHashMap<>();
        if (root.has("components")) {
            JsonNode compNode = root.get("components");
            compNode.fieldNames().forEachRemaining(fn -> {
                JsonNode v = compNode.get(fn);
                if (v != null && v.isNumber()) {
                    componentResp.put(fn, v.doubleValue());
                }
            });
        } else if (root.has("componentResponsibility")) {
            JsonNode compNode = root.get("componentResponsibility");
            compNode.fieldNames().forEachRemaining(fn -> {
                JsonNode v = compNode.get(fn);
                if (v != null && v.isNumber()) {
                    componentResp.put(fn, v.doubleValue());
                }
            });
        }
        out.setComponentResponsibility(componentResp);

        // Winning states / groups (speculative keys)
        if (root.has("winningStates") && root.get("winningStates").isArray()) {
            List<String> ws = new ArrayList<>();
            for (JsonNode x : root.get("winningStates")) ws.add(x.asText());
            out.setWinningStates(ws);
        }
        if (root.has("groups") && root.get("groups").isObject()) {
            Map<String, ResponsibilityOutput.GroupInfo> groups = new LinkedHashMap<>();
            JsonNode gNode = root.get("groups");
            gNode.fieldNames().forEachRemaining(fn -> {
                JsonNode v = gNode.get(fn);
                if (v != null && v.isObject()) {
                    List<String> members = new ArrayList<>();
                    if (v.has("members")) {
                        for (JsonNode m : v.get("members")) members.add(m.asText());
                    }
                    Double resp = v.has("responsibility") && v.get("responsibility").isNumber() ? v.get("responsibility").doubleValue() : null;
                    groups.put(fn, new ResponsibilityOutput.GroupInfo(members, resp));
                }
            });
            out.setGroups(groups);
            if (!groups.isEmpty()) out.setGroupedMode(true);
        }
        return out;
    }

    /**
     * Convert "var1=val1, var2=val2, ..." format to "val1,val2,..." format
     */
    private String convertVarValueToRawValues(String varValueFormat) {
        // Split by comma
        String[] pairs = varValueFormat.split(",");
        StringBuilder raw = new StringBuilder();
        for (int i = 0; i < pairs.length; i++) {
            String pair = pairs[i].trim();
            // Extract value after '='
            int eqIdx = pair.indexOf('=');
            if (eqIdx > 0 && eqIdx < pair.length() - 1) {
                String value = pair.substring(eqIdx + 1).trim();
                if (i > 0) raw.append(",");
                raw.append(value);
            }
        }
        return raw.toString();
    }

    /**
     * Parse fallback line-based format:
     *   s42 0.75
     *   s17 0.12
     * 
     * Also handles Rust tool format with state descriptions mapped to state IDs.
     */
    private Map<String, Double> parseLineFormat(List<String> lines, Map<String, String> stateNames) {
        Map<String, Double> stateResp = new LinkedHashMap<>();
        
        // Build reverse map: state description -> state ID
        Map<String, String> descToId = new LinkedHashMap<>();
        if (stateNames != null) {
            for (Map.Entry<String, String> entry : stateNames.entrySet()) {
                String id = entry.getKey();
                String desc = entry.getValue();
                // Normalize description by removing wrapping parens if present
                String normalized = desc.replaceAll("^\\(", "").replaceAll("\\)$", "").trim();
                descToId.put(normalized, id);
            }
        }
        
        // Pattern for simple format: "ID VALUE"
        Pattern p = Pattern.compile("^(?<id>[A-Za-z0-9_\\-\\.]+)\\s+(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)$");
        // Pattern for Rust tool Shapley format: "({(var1=val1, var2=val2, ...)}): VALUE"
        Pattern rustShapleyPattern = Pattern.compile("^\\(\\{\\((?<state>[^)]+)\\)\\}\\):\\s*(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)\\s*$");
        // Pattern for Rust tool Banzhaf format: "(var1=val1, var2=val2, ...): VALUE"
        Pattern rustBanzhafPattern = Pattern.compile("^\\((?<state>[^)]+)\\):\\s*(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)\\s*$");
        // Pattern for old Rust tool format: "(ID): (state description): VALUE"
        Pattern rustPattern = Pattern.compile("^\\((?<id>\\d+)\\):.*:\\s*(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)\\s*$");
        
        for (String line : lines) {
            if (line == null) continue;
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("Metric:")) continue;
            
            // Debug: log first few lines being processed
            if (stateResp.size() < 2) {
                logger.info("Processing line (first 80 chars): {}", trimmed.substring(0, Math.min(80, trimmed.length())));
            }
            
            // Try Shapley format first: "({(state)}): VALUE"
            Matcher shapleyMatcher = rustShapleyPattern.matcher(trimmed);
            if (shapleyMatcher.find()) {
                String stateDesc = shapleyMatcher.group("state");
                String valStr = shapleyMatcher.group("val");
                try {
                    double v = Double.parseDouble(valStr);
                    // Convert var=value format to raw values
                    String rawValues = convertVarValueToRawValues(stateDesc);
                    // Try to match against PRISM state description
                    String stateId = descToId.get(rawValues);
                    if (stateId != null) {
                        stateResp.put(stateId, v);
                    } else {
                        logger.warn("Could not map state description to ID: {} -> {}", stateDesc.substring(0, Math.min(50, stateDesc.length())), rawValues.substring(0, Math.min(30, rawValues.length())));
                    }
                } catch (NumberFormatException ignore) {
                }
                continue;
            }
            
            // Try Banzhaf format: "(state): VALUE"
            Matcher banzhafMatcher = rustBanzhafPattern.matcher(trimmed);
            if (banzhafMatcher.find()) {
                String stateDesc = banzhafMatcher.group("state");
                String valStr = banzhafMatcher.group("val");
                
                // Debug: log first few parsed lines
                if (stateResp.size() < 3) {
                    logger.info("Parsed Rust output: state={} value={}", stateDesc.substring(0, Math.min(60, stateDesc.length())), valStr);
                }
                
                try {
                    double v = Double.parseDouble(valStr);
                    // Convert var=value format to raw values
                    String rawValues = convertVarValueToRawValues(stateDesc);
                    // Try to match against PRISM state description
                    String stateId = descToId.get(rawValues);
                    if (stateId != null) {
                        stateResp.put(stateId, v);
                        if (stateResp.size() <= 3) {
                            logger.info("✓ Matched state: {} -> ID={}", rawValues.substring(0, Math.min(40, rawValues.length())), stateId);
                        }
                    } else {
                        logger.warn("Could not map state description to ID: {} -> {}", stateDesc.substring(0, Math.min(50, stateDesc.length())), rawValues.substring(0, Math.min(30, rawValues.length())));
                    }
                } catch (NumberFormatException ignore) {
                }
                continue;
            }
            
            // Try old Rust format
            Matcher rustMatcher = rustPattern.matcher(trimmed);
            if (rustMatcher.find()) {
                String id = rustMatcher.group("id");
                try {
                    double v = Double.parseDouble(rustMatcher.group("val"));
                    stateResp.put(id, v);
                } catch (NumberFormatException ignore) {
                }
                continue;
            }
            // Fall back to simple format
            Matcher m = p.matcher(trimmed);
            if (m.find()) {
                String id = m.group("id");
                try {
                    double v = Double.parseDouble(m.group("val"));
                    stateResp.put(id, v);
                } catch (NumberFormatException ignore) {
                }
            }
        }
        return stateResp;
    }

    private Map<String, ResponsibilityOutput.StateInfo> enrichStateMetadata(Map<String, Double> stateResp, List<String> trace) {
        Map<String, ResponsibilityOutput.StateInfo> meta = new LinkedHashMap<>();
        if (stateResp == null) return meta;
        Set<String> traceSet = trace != null ? new LinkedHashSet<>(trace) : Collections.emptySet();
        for (String id : stateResp.keySet()) {
            ResponsibilityOutput.StateInfo info = new ResponsibilityOutput.StateInfo();
            info.setOnTrace(traceSet.contains(id));
            info.setBranchingDegree(null); // Unknown – could derive from a TS extractor later
            info.setCanWinAlone(null); // Unknown until tool exposes this directly
            meta.put(id, info);
        }
        return meta;
    }

    private void safeDelete(Path dir) {
        try {
            Files.walk(dir)
                .sorted(Comparator.reverseOrder())
                .forEach(p -> {
                    try { Files.deleteIfExists(p); } catch (IOException ignored) {}
                });
        } catch (IOException ignored) {
        }
    }

    /**
     * Extract state names from PRISM model by running prism export.
     * Uses the PRISM CLI to export the state space and extract state representations.
     * This is faster than loading the full model in-memory.
     */
    private Map<String, String> extractStateNamesFromModel(String modelFile) throws Exception {
        Map<String, String> stateNames = new LinkedHashMap<>();
        
        // Create a temporary file for state export
        Path statesFile = Files.createTempFile("states_", ".txt");
        try {
            // Determine PRISM executable path
            String prismPath = System.getenv("PRISM_PATH");
            if (prismPath == null || prismPath.isBlank()) {
                // Try common locations
                String[] candidates = {
                    "/Users/aldo/opt/prism-source/prism/bin/prism",
                    "/usr/local/bin/prism",
                    "/opt/prism/bin/prism",
                    "prism"
                };
                for (String candidate : candidates) {
                    if (new java.io.File(candidate).exists() || candidate.equals("prism")) {
                        prismPath = candidate;
                        break;
                    }
                }
            }
            
            // Run PRISM to export states: prism model.prism -exportstates states.txt
            ProcessBuilder pb = new ProcessBuilder(
                prismPath,
                modelFile,
                "-exportstates",
                statesFile.toString()
            );
            
            // Set library path for PRISM
            Map<String, String> env = pb.environment();
            String libPath = System.getenv("DYLD_LIBRARY_PATH");
            if (libPath != null) {
                env.put("DYLD_LIBRARY_PATH", libPath);
            }
            
            Process proc = pb.start();
            int exitCode = proc.waitFor();
            
            if (exitCode != 0) {
                throw new Exception("PRISM export states failed with code " + exitCode);
            }
            
            // Parse the states file
            // Format: first line is variable names: "(var1,var2,...)"
            // Then each line is "stateId:(val1,val2,...)"
            // We need to convert to "var1=val1, var2=val2, ..." format to match Rust tool
            List<String> varNames = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new FileReader(statesFile.toFile()))) {
                String line;
                boolean firstLine = true;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    
                    if (firstLine) {
                        // Parse variable names: "(p1l,p1r,e1,...)"
                        String varLine = line.replaceAll("^\\(", "").replaceAll("\\)$", "");
                        String[] vars = varLine.split(",");
                        for (String var : vars) {
                            varNames.add(var.trim());
                        }
                        firstLine = false;
                        continue;
                    }
                    
                    // Parse state line: "id:(val1,val2,...)"
                    int colonIdx = line.indexOf(':');
                    if (colonIdx > 0) {
                        String id = line.substring(0, colonIdx).trim();
                        String valuesStr = line.substring(colonIdx + 1).trim();
                        
                        // Store the raw state representation as-is (matches graph node name format)
                        // Graph nodes have names like "(0,0,0,0)" from PRISM export
                        stateNames.put(id, valuesStr);
                        
                        // Debug: log first few state mappings
                        if (stateNames.size() <= 3) {
                            logger.info("State mapping example: id={} -> desc={}", id, valuesStr.substring(0, Math.min(60, valuesStr.length())));
                        }
                    }
                }
            }
            
            return stateNames;
            
        } finally {
            Files.deleteIfExists(statesFile);
        }
    }
}
