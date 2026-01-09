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
        if (code != 0) {
            logger.error("Responsibility tool exited with code {}. Output:\n{}", code, console);
            throw new Exception("Responsibility tool failed (exit=" + code + ")");
        }
        logger.debug("Responsibility tool raw output ({} bytes)\n{}", console.length(), console);

        ResponsibilityOutput output = parsePreferred(outFile, altFile, console.toString());
        output.setLevel(level);
        output.setResponsibilityType(mode);
        output.setPowerIndex(index);
        output.setCounterexample(overrideTrace); // only set if provided
        output.setApproximate(false); // assume exact – may adjust if tool exposes flag
        output.setGroupedMode(Boolean.FALSE); // will update after inspecting tool grouping output
        output.setStateMetadata(enrichStateMetadata(output.getStateResponsibility(), overrideTrace));

        // Extract state ID to name mapping using lightweight PRISM CLI
        // (avoids slow Java API - see Nov 26 report: "dropped from 18s to 8s")
        Map<String, String> stateMapping = PrismStateMapper.extractStateMapping(absoluteModelFile);
        if (!stateMapping.isEmpty()) {
            output.setStateIdToName(stateMapping);
        } else {
            logger.warn("State mapping empty - frontend may not match states correctly");
        }

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
        cmd.add("-v");
        cmd.add(version);

        // NOTE: Refinement (-a flag) disabled to get stable, verified values
        // that match the November 2025 report. The refinement engine produces
        // grouped results with different responsibility values.
        // if (level > 0) {
        //     cmd.add("-a");
        // }

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

    private ResponsibilityOutput parsePreferred(Path jsonFile, Path txtFile, String console) throws Exception {
        // The tool writes text format even to .json files, so try text parse first on any existing file
        if (Files.exists(jsonFile)) {
            try (BufferedReader br = new BufferedReader(new FileReader(jsonFile.toFile(), StandardCharsets.UTF_8))) {
                java.util.List<String> lines = new java.util.ArrayList<>();
                br.lines().forEach(lines::add);
                logger.debug("Reading from jsonFile (as text): {} lines", lines.size());
                Map<String, Double> stateResp = parseLineFormat(lines);
                if (!stateResp.isEmpty()) {
                    logger.info("Parsed {} states from output file", stateResp.size());
                    ResponsibilityOutput o = new ResponsibilityOutput();
                    o.setStateResponsibility(stateResp);
                    o.setComponentResponsibility(Collections.emptyMap());
                    return o;
                }
            } catch (Exception e) {
                logger.warn("Text parse of jsonFile failed ({}). Trying other sources.", e.getMessage());
            }
        }
        if (Files.exists(txtFile)) {
            try (BufferedReader br = new BufferedReader(new FileReader(txtFile.toFile(), StandardCharsets.UTF_8))) {
                java.util.List<String> lines = new java.util.ArrayList<>();
                br.lines().forEach(lines::add);
                Map<String, Double> stateResp = parseLineFormat(lines);
                if (!stateResp.isEmpty()) {
                    logger.info("Parsed {} states from txt file", stateResp.size());
                    ResponsibilityOutput o = new ResponsibilityOutput();
                    o.setStateResponsibility(stateResp);
                    o.setComponentResponsibility(Collections.emptyMap());
                    return o;
                }
            }
        }
        // Attempt parse from console stdout if no files worked
        logger.debug("Parsing from console output ({} chars)", console.length());
        Map<String, Double> stateResp = parseLineFormat(Arrays.asList(console.split("\n")));
        logger.info("Parsed {} states from console output", stateResp.size());
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
     * Parse fallback line-based format:
     *   s42 0.75
     *   s17 0.12
     */
    private Map<String, Double> parseLineFormat(List<String> lines) {
        Map<String, Double> stateResp = new LinkedHashMap<>();
        // Pattern for simple format: "ID VALUE"
        Pattern p = Pattern.compile("^(?<id>[A-Za-z0-9_\\-\\.]+)\\s+(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)$");
        // Pattern for Rust tool format WITH ID: "(ID): (state description): VALUE"
        Pattern rustPattern = Pattern.compile("^\\((?<id>\\d+)\\):.*:\\s*(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)\\s*$");
        // Pattern for Rust tool format WITHOUT ID (file output): "(state=value, ...): VALUE"
        // The line format is: (var1=val1, var2=val2, ...): 0.12345678
        // We need to match from the first ( to the last ): then capture the number
        Pattern noIdPattern = Pattern.compile("^\\(.*\\):\\s*(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)\\s*$");
        int autoId = 0;
        for (String line : lines) {
            if (line == null) continue;
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("Metric:") || trimmed.startsWith("Sum of")) continue;
            
            // Try Rust format with ID first
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
            // Try format without ID (from file output)
            Matcher noIdMatcher = noIdPattern.matcher(trimmed);
            if (noIdMatcher.find()) {
                try {
                    double v = Double.parseDouble(noIdMatcher.group("val"));
                    stateResp.put(String.valueOf(autoId++), v);
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
}
