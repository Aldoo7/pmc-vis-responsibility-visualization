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
 * Invokes the external Rust responsibility tool (actor-based responsibility) and
 * converts its output into {@link ResponsibilityOutput}.
 *
 * Design goals:
 *  - Pure adapter: no domain logic beyond parsing and mapping.
 *  - Resilient to different output formats (JSON preferred; fallback line-based).
 *  - Non-blocking friendly (currently synchronous; can be wrapped async later).
 *
 * Expected CLI (assumptions – will be refined once README is inspected):
 *   responsibility_tool \
 *     --model <model.prism> \
 *     --property "Pmax=?[F error]" \
 *     --mode optimistic|pessimistic \
 *     --index shapley|banzhaf \
 *     --level <int> \
 *     --output <path/to/output.json>
 *
 * If the tool supports -h we will introspect supported flags; until then we construct
 * a conservative argument list and rely on environment configuration.
 */
public class RustResponsibilityInvoker {

    private static final Logger logger = LoggerFactory.getLogger(RustResponsibilityInvoker.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final String binaryPath; // absolute path to compiled Rust binary

    public RustResponsibilityInvoker(String binaryPath) {
        this.binaryPath = binaryPath;
    }

    /**
     * Execute the external tool and parse the result.
     * @param modelFile PRISM model path
     * @param property Property string (may be optional if tool derives internally)
     * @param mode optimistic|pessimistic
     * @param index shapley|banzhaf|custom
     * @param level refinement level (adapter passes through – tool may ignore)
     * @param overrideTrace optional explicit counterexample trace
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
        Path workDir = Files.createTempDirectory("resp_tool_");
        Path outFile = workDir.resolve("responsibility.json");
        Path altFile = workDir.resolve("responsibility.txt");

        List<String> cmd = buildCommand(modelFile, property, mode, index, level, outFile, altFile, overrideTrace);
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
        // Assumed flags – adapt once README verified
        cmd.add("--model");
        cmd.add(modelFile);
        if (property != null && !property.isBlank()) {
            cmd.add("--property");
            cmd.add(property);
        }
        if (mode != null) {
            cmd.add("--mode");
            cmd.add(mode);
        }
        if (index != null) {
            cmd.add("--index");
            cmd.add(index);
        }
        cmd.add("--level");
        cmd.add(String.valueOf(level));
        // Preferred JSON output file
        cmd.add("--output");
        cmd.add(outFile.toString());
        // Fallback plain text output (if tool supports separate flag – placeholder)
        // cmd.add("--txt-output"); cmd.add(altFile.toString()); // uncomment if supported

        if (overrideTrace != null && !overrideTrace.isEmpty()) {
            // Provide explicit trace via a temp file if tool accepts --trace-file flag
            try {
                Path traceFile = Files.createTempFile("trace_", ".txt");
                Files.write(traceFile, overrideTrace, StandardCharsets.UTF_8);
                cmd.add("--trace-file");
                cmd.add(traceFile.toString());
            } catch (IOException e) {
                logger.warn("Failed to create temporary trace file: {}", e.getMessage());
            }
        }
        return cmd;
    }

    private ResponsibilityOutput parsePreferred(Path jsonFile, Path txtFile, String console) throws Exception {
        if (Files.exists(jsonFile)) {
            try {
                byte[] data = Files.readAllBytes(jsonFile);
                JsonNode root = mapper.readTree(data);
                return parseJson(root);
            } catch (Exception e) {
                logger.warn("JSON parse failed ({}). Falling back to line parse.", e.getMessage());
            }
        }
        if (Files.exists(txtFile)) {
            try (BufferedReader br = new BufferedReader(new FileReader(txtFile.toFile(), StandardCharsets.UTF_8))) {
                java.util.List<String> lines = new java.util.ArrayList<>();
                br.lines().forEach(lines::add); // Java 11 compatible
                Map<String, Double> stateResp = parseLineFormat(lines);
                ResponsibilityOutput o = new ResponsibilityOutput();
                o.setStateResponsibility(stateResp);
                o.setComponentResponsibility(Collections.emptyMap());
                return o;
            }
        }
        // Attempt parse from console stdout if no files
        Map<String, Double> stateResp = parseLineFormat(Arrays.asList(console.split("\n")));
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
    Pattern p = Pattern.compile("^(?<id>[A-Za-z0-9_\\-\\.]+)\\s+(?<val>[0-9]*\\.?[0-9]+(?:[eE][+\\-]?[0-9]+)?)$");
        for (String line : lines) {
            if (line == null) continue;
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
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
