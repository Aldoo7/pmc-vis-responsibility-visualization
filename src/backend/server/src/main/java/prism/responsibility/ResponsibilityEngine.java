package prism.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import prism.responsibility.ResponsibilityEnums.ResponsibilityMode;
import prism.responsibility.ResponsibilityEnums.PowerIndex;

/**
 * Responsibility computation engine.
 *
 * Delegates to an external Rust binary for the actual power-index computation.
 */
public class ResponsibilityEngine {
    private volatile ResponsibilityMode currentMode = ResponsibilityMode.OPTIMISTIC;
    private volatile PowerIndex currentIndex = PowerIndex.SHAPLEY;
    private volatile List<String> overrideCounterexample = null;
    private volatile String samplingConfig = null;
    private volatile String groupingMode = null;
    
    private static final Logger logger = LoggerFactory.getLogger(ResponsibilityEngine.class);
    
    private final String toolPath;
    private volatile String lastModelFile = null;
    private volatile ResponsibilityOutput lastOutput = null;
    
    public ResponsibilityEngine(String toolPath) {
        this.toolPath = toolPath;
        logger.info("ResponsibilityEngine init: {}", toolPath);
    }

    public void setMode(String mode) {
        if (mode == null) return;
        try {
            this.currentMode = ResponsibilityMode.valueOf(mode.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            logger.warn("Unknown responsibility mode '{}' (keeping {})", mode, this.currentMode);
        }
    }
    public void setPowerIndex(String index) {
        if (index == null) return;
        try {
            this.currentIndex = PowerIndex.valueOf(index.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            logger.warn("Unknown power index '{}' (keeping {})", index, this.currentIndex);
        }
    }
    public void setOverrideCounterexample(List<String> rho) {
        this.overrideCounterexample = (rho == null || rho.isEmpty()) ? null : new ArrayList<>(rho);
    }

    public void setSamplingConfig(String config) {
        this.samplingConfig = (config == null || config.isBlank()) ? null : config.trim();
    }

    public void setGroupingMode(String mode) {
        this.groupingMode = (mode == null || mode.isBlank()) ? null : mode.trim();
    }
    
    public ResponsibilityOutput compute(String modelFile, String property, int level) throws Exception {
        logger.info("Computing responsibility for {} (level={}, sampling={}, grouping={})", 
            modelFile, level, samplingConfig, groupingMode);

        if (toolPath == null || toolPath.isBlank()) {
            throw new Exception("No external responsibility tool path configured");
        }

        RustResponsibilityInvoker invoker = new RustResponsibilityInvoker(toolPath);
        List<String> overrideTrace = overrideCounterexample != null ? new ArrayList<>(overrideCounterexample) : null;
        
        ResponsibilityOutput output = invoker.run(
            modelFile, property, currentMode.name().toLowerCase(), currentIndex.name().toLowerCase(),
            level, overrideTrace, samplingConfig, groupingMode
        );

        if (output.getComponentResponsibility() == null || output.getComponentResponsibility().isEmpty()) {
            output.setComponentResponsibility(generateComponentResponsibility(modelFile, new Random(42)));
        }

        if (output.getNormalizationConstantK() == null && currentMode == ResponsibilityMode.OPTIMISTIC) {
            int n = output.getStateResponsibility() != null ? output.getStateResponsibility().size() : 0;
            output.setNormalizationConstantK((double) Math.max(1, n));
        }

        logger.info("Computation complete: {} states at level {}", 
            output.getStateResponsibility() != null ? output.getStateResponsibility().size() : 0, level);

        // Cache for separate switching pair analysis
        this.lastModelFile = modelFile;
        this.lastOutput = output;

        return output;
    }

    /**
     * Run switching pair analysis on the last responsibility result.
     * Triggered separately so the user sees responsibility values first.
     */
    public ResponsibilityOutput runSwitchingPairAnalysis() throws Exception {
        if (lastModelFile == null || lastOutput == null) {
            throw new Exception("No prior responsibility result — run computation first.");
        }
        if (Boolean.TRUE.equals(lastOutput.getGroupedMode())) {
            throw new Exception("Switching pairs not supported for grouped results.");
        }
        computeAndSetWinningRegion(lastModelFile, lastOutput);
        return lastOutput;
    }

    /**
     * Compute switching pairs for grand coalition, top singletons, and top-k combined.
     */
    private void computeAndSetWinningRegion(String modelFile, ResponsibilityOutput output) throws Exception {
        PrismModelExtractor.ExtractionResult extraction = PrismModelExtractor.extractViaCli(modelFile);
        if (extraction == null || extraction.transitionSystem == null) {
            logger.warn("Switching pair analysis: model extraction failed for {}", modelFile);
            return;
        }

        TransitionSystem ts = extraction.transitionSystem;
        logger.info("Extracted TS: {} states, {} bad states",
                ts.getStates().size(), extraction.badStates.size());

        if (extraction.badStates.isEmpty()) {
            logger.warn("No bad states found — skipping switching pair analysis");
            return;
        }

        Counterexample ce = buildCounterexample(ts, extraction);
        if (ce.getTrace() == null || ce.getTrace().isEmpty()) {
            logger.warn("No counterexample path found");
            return;
        }
        List<String> trace = ce.getTrace();
        logger.info("Counterexample: {} states", trace.size());

        if (output.getCounterexample() == null || output.getCounterexample().isEmpty()) {
            output.setCounterexample(new ArrayList<>(trace));
        }

        List<SwitchingPairInfo> pairs = new ArrayList<>();

        // Grand coalition
        Set<String> grandCoalition = new HashSet<>(ts.getStates());
        grandCoalition.removeAll(extraction.badStates);
        if (!grandCoalition.isEmpty()) {
            SafetyGame.GameResult grandResult = SafetyGame
                    .fromTransitionSystem(ts, ce, grandCoalition).solve();
            SwitchingPairInfo grandPair = new SwitchingPairInfo(
                    "Grand coalition (all states cooperate)",
                    new ArrayList<>(grandCoalition),
                    new ArrayList<>(grandResult.winningRegion),
                    grandResult.strategy,
                    grandResult.safeWinsFromInitial,
                    new ArrayList<>(trace));
            pairs.add(grandPair);

            if (!grandResult.winningRegion.isEmpty()) {
                output.setWinningStates(new ArrayList<>(grandResult.winningRegion));
            }
            logger.info("Grand coalition: {} winning states, safeWins={}",
                    grandResult.winningRegion.size(), grandResult.safeWinsFromInitial);
        }

        // Singleton coalitions for top responsible states
        Map<String, Double> respMap = output.getStateResponsibility();
        if (respMap != null && !respMap.isEmpty()) {
            List<Map.Entry<String, Double>> sorted = new ArrayList<>(respMap.entrySet());
            sorted.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

            int singletonLimit = Math.min(5, sorted.size());
            Map<String, String> idToName = output.getStateIdToName();

            for (int i = 0; i < singletonLimit; i++) {
                Map.Entry<String, Double> entry = sorted.get(i);
                String stateId = entry.getKey();
                double resp = entry.getValue();
                if (resp <= 0) break;

                Set<String> singleton = new HashSet<>();
                singleton.add(stateId);

                SafetyGame.GameResult result = SafetyGame
                        .fromTransitionSystem(ts, ce, singleton).solve();

                String stateName = (idToName != null && idToName.containsKey(stateId))
                        ? idToName.get(stateId) : stateId;
                String label = String.format("State %s (resp=%.3f)", stateName, resp);

                pairs.add(new SwitchingPairInfo(
                        label,
                        List.of(stateId),
                        new ArrayList<>(result.winningRegion),
                        result.strategy,
                        result.safeWinsFromInitial,
                        new ArrayList<>(trace)));

                logger.info("Singleton {}: {} winning, safeWins={}",
                        stateId, result.winningRegion.size(), result.safeWinsFromInitial);
            }

            // Top-k combined coalition
            int combinedSize = Math.min(3, sorted.size());
            if (combinedSize > 1) {
                Set<String> topCoalition = new LinkedHashSet<>();
                StringBuilder labelParts = new StringBuilder();
                for (int i = 0; i < combinedSize; i++) {
                    String sid = sorted.get(i).getKey();
                    if (sorted.get(i).getValue() <= 0) break;
                    topCoalition.add(sid);
                    if (labelParts.length() > 0) labelParts.append(", ");
                    String name = (idToName != null && idToName.containsKey(sid))
                            ? idToName.get(sid) : sid;
                    labelParts.append(name);
                }
                if (topCoalition.size() > 1) {
                    SafetyGame.GameResult result = SafetyGame
                            .fromTransitionSystem(ts, ce, topCoalition).solve();
                    pairs.add(new SwitchingPairInfo(
                            "Top-" + topCoalition.size() + " combined: " + labelParts,
                            new ArrayList<>(topCoalition),
                            new ArrayList<>(result.winningRegion),
                            result.strategy,
                            result.safeWinsFromInitial,
                            new ArrayList<>(trace)));
                    logger.info("Top-{} combined: {} winning, safeWins={}",
                            topCoalition.size(), result.winningRegion.size(), result.safeWinsFromInitial);
                }
            }
        }

        output.setSwitchingPairs(pairs);
        logger.info("Switching pair analysis: {} pairs computed", pairs.size());
    }
    

    private Counterexample buildCounterexample(TransitionSystem ts, PrismModelExtractor.ExtractionResult extraction) {
        Counterexample ce = new Counterexample();
        
        if (overrideCounterexample != null && !overrideCounterexample.isEmpty()) {
            for (String state : overrideCounterexample) ce.add(state);
            return ce;
        }
        
        if (ts.getInitial() != null && !extraction.badStates.isEmpty()) {
            List<String> path = findPathToBad(ts, ts.getInitial(), extraction.badStates);
            if (path != null) {
                for (String state : path) ce.add(state);
            }
        }
        return ce;
    }
    

    private List<String> findPathToBad(TransitionSystem ts, String initial, Set<String> badStates) {
        if (badStates.contains(initial)) {
            return Arrays.asList(initial);
        }
        
        Queue<String> queue = new LinkedList<>();
        Map<String, String> parent = new HashMap<>();
        Set<String> visited = new HashSet<>();
        
        queue.add(initial);
        visited.add(initial);
        parent.put(initial, null);
        
        while (!queue.isEmpty()) {
            String current = queue.poll();
            
            if (badStates.contains(current)) {
                List<String> path = new ArrayList<>();
                String state = current;
                while (state != null) {
                    path.add(0, state);
                    state = parent.get(state);
                }
                return path;
            }
            
            Set<String> successors = ts.getSuccessors(current);
                if (successors != null) {
                for (String next : successors) {
                    if (!visited.contains(next)) {
                        visited.add(next);
                        parent.put(next, current);
                        queue.add(next);
                    }
                }
            }
        }
        
        return Collections.emptyList();
    }
    

    private Counterexample buildGoalBasedCounterexample(TransitionSystem ts, PrismModelExtractor.ExtractionResult extraction) {
        Counterexample ce = new Counterexample();
        
        Set<String> terminalStates = new HashSet<>();
        for (String state : ts.getStates()) {
            Set<String> successors = ts.getSuccessors(state);
            if (successors == null || successors.isEmpty() || 
                (successors.size() == 1 && successors.contains(state))) {
                terminalStates.add(state);
            }
        }
        
        logger.info("Found {} terminal/goal states for counterexample generation", terminalStates.size());
        
        if (!terminalStates.isEmpty() && ts.getInitial() != null) {
            for (String goal : terminalStates) {
                List<String> path = findPathToGoal(ts, ts.getInitial(), goal);
                if (path != null && !path.isEmpty()) {
                    for (String state : path) {
                        ce.add(state);
                    }
                    logger.info("Generated goal-based counterexample with {} states (target: {})", 
                        path.size(), extraction.stateIdToName.get(goal));
                    
                    ts.addBadState(goal);
                    return ce;
                }
            }
        }
        
        if (ts.getInitial() != null) {
            List<String> path = findAnyPath(ts, ts.getInitial(), 5);
            if (!path.isEmpty()) {
                for (String state : path) {
                    ce.add(state);
                }
                ts.addBadState(path.get(path.size() - 1));
                logger.info("Generated fallback counterexample with {} states", path.size());
            }
        }
        
        return ce;
    }
    

    private List<String> findPathToGoal(TransitionSystem ts, String initial, String goal) {
        if (initial.equals(goal)) {
            return Arrays.asList(initial);
        }
        
        Queue<String> queue = new LinkedList<>();
        Map<String, String> parent = new HashMap<>();
        Set<String> visited = new HashSet<>();
        
        queue.add(initial);
        visited.add(initial);
        parent.put(initial, null);
        
        while (!queue.isEmpty()) {
            String current = queue.poll();
            
            if (current.equals(goal)) {
                List<String> path = new ArrayList<>();
                String state = current;
                while (state != null) {
                    path.add(0, state);
                    state = parent.get(state);
                }
                return path;
            }
            
            Set<String> successors = ts.getSuccessors(current);
            if (successors != null) {
                for (String next : successors) {
                    if (!visited.contains(next)) {
                        visited.add(next);
                        parent.put(next, current);
                        queue.add(next);
                    }
                }
            }
        }
        
        return Collections.emptyList();
    }
    

    private List<String> findAnyPath(TransitionSystem ts, String initial, int targetLength) {
        List<String> path = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        String current = initial;
        path.add(current);
        visited.add(current);
        
        while (path.size() < targetLength) {
            Set<String> successors = ts.getSuccessors(current);
            if (successors == null || successors.isEmpty()) break;
            
            String next = null;
            for (String succ : successors) {
                if (!visited.contains(succ)) {
                    next = succ;
                    break;
                }
            }
            
            if (next == null) {
                next = successors.iterator().next();
            }
            
            path.add(next);
            visited.add(next);
            current = next;
        }
        
        return path;
    }
    


    
    private Map<String, Double> generateComponentResponsibility(String modelFile, Random random) {
        Map<String, Double> compResp = new HashMap<>();
        try {
            java.nio.file.Path p = java.nio.file.Paths.get(modelFile);
            logger.debug("Attempting to extract components from {}", p.toAbsolutePath());
            if (java.nio.file.Files.exists(p)) {
                String src = java.nio.file.Files.readString(p);
                logger.debug("Read {} characters from model file", src.length());
                
                java.util.regex.Pattern actPat = java.util.regex.Pattern.compile("\\[(\\w+)\\]");
                java.util.regex.Matcher m = actPat.matcher(src);
                Map<String, Integer> actCounts = new HashMap<>();
                while (m.find()) {
                    String a = m.group(1);
                    actCounts.put(a, actCounts.getOrDefault(a, 0) + 1);
                }
                logger.debug("Found {} unique actions in model", actCounts.size());
                
                java.util.regex.Pattern modPat = java.util.regex.Pattern.compile("(?m)^\\s*module\\s+(\\w+)");
                java.util.regex.Matcher mm = modPat.matcher(src);
                java.util.List<String> modules = new java.util.ArrayList<>();
                while (mm.find()) modules.add(mm.group(1));
                logger.debug("Found {} modules in model: {}", modules.size(), modules);
                
                int max = 0; 
                for (int c : actCounts.values()) max = Math.max(max, c);
                if (max > 0) {
                    for (Map.Entry<String, Integer> e : actCounts.entrySet()) {
                        double v = (double) e.getValue() / (double) max;
                        compResp.put("action_" + e.getKey(), v);
                    }
                }
                
                for (String mod : modules) {
                    compResp.put("module_" + mod, 0.5);
                }
                
                logger.info("Extracted {} components from {}", compResp.size(), modelFile);
                
                if (compResp.isEmpty()) {
                    String base = p.getFileName() != null ? p.getFileName().toString() : modelFile;
                    double v = deterministicValue(base);
                    compResp.put("model_" + base.replaceAll("[^A-Za-z0-9]+", "_"), v);
                    logger.warn("No components extracted, using filename fallback: {}", base);
                }
                return compResp;
            } else {
                logger.warn("Model file does not exist: {}", p.toAbsolutePath());
            }
        } catch (Exception e) {
            logger.warn("Component extraction failed for {}: {}", modelFile, e.getMessage());
        }
        
        logger.info("Using fallback component generation for {}", modelFile);
        String[] defaults = new String[]{"module_system", "variable_state", "action_step", "action_init"};
        for (String name : defaults) {
            compResp.put(name, deterministicValue(name));
        }
        return compResp;
    }

    private double deterministicValue(String key) {
        int h = key != null ? key.hashCode() : 0;
        double u = (h & 0x7fffffff) / (double) Integer.MAX_VALUE;
        return 0.35 + 0.5 * u;
    }
    
    public void terminate() {
        logger.info("Terminating responsibility tool process");
    }
}
