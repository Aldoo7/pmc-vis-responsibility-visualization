package prism.responsibility;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import prism.responsibility.ResponsibilityEnums.ResponsibilityMode;
import prism.responsibility.ResponsibilityEnums.PowerIndex;

/**
 * Mock Responsibility Engine for Development
 *
 * This class simulates the external responsibility tool during development.
 * It generates realistic-looking fake data so the UI can be built and tested
 * before integrating with the real tool.
 *
 * Usage:
 *   ResponsibilityEngine engine = new ResponsibilityEngine("mock");
 *   ResponsibilityOutput result = engine.compute("model.prism", "Pmax=?[F error]", 2);
 *
 * The mock mode will be replaced with real tool integration later.
 */
public class ResponsibilityEngine {
    // Configurable mode/index and optional provided counterexample (default optimistic + shapley)
    private volatile ResponsibilityMode currentMode = ResponsibilityMode.OPTIMISTIC;
    private volatile PowerIndex currentIndex = PowerIndex.SHAPLEY;
    private volatile List<String> overrideCounterexample = null;
    
    private static final Logger logger = LoggerFactory.getLogger(ResponsibilityEngine.class);
    
    @SuppressWarnings("unused")  // Will be used in Week 3 for real tool integration
    private final String toolPath;
    private final boolean isMockMode;
    
    /**
     * Constructor
     * @param toolPath Path to the external responsibility tool executable,
     *                 or "mock" to use simulated data
     */
    public ResponsibilityEngine(String toolPath) {
        this.toolPath = toolPath;
        this.isMockMode = (toolPath == null || toolPath.isEmpty() || toolPath.equalsIgnoreCase("mock"));
        
        if (isMockMode) {
            logger.info("Responsibility Engine initialized in MOCK mode");
        } else {
            logger.info("Responsibility Engine initialized with tool at: {}", toolPath);
        }
    }

    /* === Configuration setters (called by socket handler) === */
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
    
    /**
     * Compute responsibility values
     * 
     * @param modelFile Path to the PRISM model file (.prism)
     * @param property The property being checked (e.g., "Pmax=?[F error]")
     * @param level Refinement level (0-10, higher = more detailed/slower)
     * @return ResponsibilityOutput containing state and component responsibilities
     * @throws Exception if computation fails
     */
    public ResponsibilityOutput compute(String modelFile, String property, int level) throws Exception {
        if (isMockMode) {
            // In mock mode we still simulate a strategy dispatch to exercise code paths
            return computeMock(modelFile, property, level);
        }
        // Real execution path: build transition system, select strategy, compute
        return computeReal(modelFile, property, level);
    }
    
    /**
     * Mock computation - generates fake data for testing
     */
    private ResponsibilityOutput computeMock(String modelFile, String property, int level) {
        logger.debug("Mock computing responsibility for {} at level {}", modelFile, level);
        
        // Simulate some computation time
        try {
            Thread.sleep(200 + level * 50);  // 200-700ms depending on level
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        Random random = new Random(42 + level);  // Deterministic randomness for consistency
        
        // Strategy selection based on current mode
        ResponsibilityStrategy strategy = selectStrategy();
        
        // Build a realistic transition system that matches the PMC-VIS graph structure
        TransitionSystem ts = buildMockTransitionSystem(level);
        
        // Build counterexample if provided
        Counterexample ce = buildMockCounterexample(ts);
        
        // **IMPORTANT**: Use the real strategy to compute responsibility!
        ResponsibilityOutput output = strategy.compute(ts, ce, level, currentIndex);
        
        // Add component responsibilities (model-specific analysis)
        Map<String, Double> compResp = generateComponentResponsibility(modelFile, random);
        output.setComponentResponsibility(compResp);
        
        // Add other metadata
        output.setPowerIndex(currentIndex.name().toLowerCase());
        
        // Build a simple weight vector p_i summing to ~1 for illustration
        int n = ts.getStates().size();
        double[] p = new double[Math.min(n, 10)];
        Arrays.fill(p, 1.0 / p.length);
        List<Double> weightsList = new ArrayList<>();
        for (double v : p) weightsList.add(v);
        output.setWeights(weightsList);
        
        // Counterexample, winning states, and state metadata are now populated by the strategy
        // Normalization constant K (number of states for now)
        output.setNormalizationConstantK((double) n);
        
        // Approximation flags (mock off)
        output.setApproximate(false);
        output.setGroupedMode(false);
        
        logger.info("Mock computation complete: {} states, {} components at level {}", 
            output.getStateResponsibility().size(), 
            output.getComponentResponsibility().size(), 
            level);
        
        return output;
    }

    /**
     * Select strategy based on current configuration.
     * Uses CORRECTED implementations matching paper formulas exactly.
     */
    private ResponsibilityStrategy selectStrategy() {
        switch (currentMode) {
            case OPTIMISTIC:
                return new OptimisticExactStrategyCorrected();
            case PESSIMISTIC:
                return new PessimisticExactStrategyCorrected();
            default:
                return new OptimisticExactStrategyCorrected(); // safe fallback
        }
    }
    
    /**
     * Real computation - calls external tool
     */
    private ResponsibilityOutput computeReal(String modelFile, String property, int level) throws Exception {
        logger.info("Computing real responsibility for {} at level {}", modelFile, level);
        // If toolPath points to external Rust binary, prefer invoking it directly now.
        // We keep previous Java-based fallback extraction in place (commented block above) in case
        // we later need hybrid approaches (e.g., pre-processing with PRISM). For v1 integration
        // we delegate fully to the external binary.

        if (toolPath == null || toolPath.isBlank()) {
            throw new Exception("No external responsibility tool path configured");
        }

        RustResponsibilityInvoker invoker = new RustResponsibilityInvoker(toolPath);
        List<String> overrideTrace = overrideCounterexample != null ? new ArrayList<>(overrideCounterexample) : null;
        String modeStr = currentMode.name().toLowerCase();
        String indexStr = currentIndex.name().toLowerCase();
        ResponsibilityOutput output = invoker.run(modelFile, property, modeStr, indexStr, level, overrideTrace);

        // If external tool did not provide component responsibilities, synthesize them for UI continuity
        if (output.getComponentResponsibility() == null || output.getComponentResponsibility().isEmpty()) {
            Map<String, Double> compResp = generateComponentResponsibility(modelFile, new Random(42));
            output.setComponentResponsibility(compResp);
        }

        // Normalization constant (if optimistic mode and not supplied) – derive heuristically
        if (output.getNormalizationConstantK() == null && currentMode == ResponsibilityMode.OPTIMISTIC) {
            int n = output.getStateResponsibility() != null ? output.getStateResponsibility().size() : 0;
            output.setNormalizationConstantK((double) Math.max(1, n));
        }

        logger.info("Real (external) computation complete: {} states, {} components at level {}", 
            output.getStateResponsibility() != null ? output.getStateResponsibility().size() : 0,
            output.getComponentResponsibility() != null ? output.getComponentResponsibility().size() : 0,
            level);
        return output;
    }
    
    /**
     * Build a counterexample trace from the transition system.
     * Uses override if provided, otherwise generates a path from initial to bad state.
     */
    private Counterexample buildCounterexample(TransitionSystem ts, PrismModelExtractor.ExtractionResult extraction) {
        Counterexample ce = new Counterexample();
        
        // Use override if provided
        if (overrideCounterexample != null && !overrideCounterexample.isEmpty()) {
            for (String state : overrideCounterexample) {
                ce.add(state);
            }
            return ce;
        }
        
        // Generate path from initial to a bad state using BFS
        if (ts.getInitial() != null && !extraction.badStates.isEmpty()) {
            List<String> path = findPathToBad(ts, ts.getInitial(), extraction.badStates);
            if (path != null && !path.isEmpty()) {
                for (String state : path) {
                    ce.add(state);
                }
            }
        }
        
        return ce;
    }
    
    /**
     * Find a shortest path from initial state to any bad state using BFS.
     */
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
            
            // Found a bad state - reconstruct path
            if (badStates.contains(current)) {
                List<String> path = new ArrayList<>();
                String state = current;
                while (state != null) {
                    path.add(0, state);
                    state = parent.get(state);
                }
                return path;
            }
            
            // Explore successors
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
        
        // No path found
        return Collections.emptyList();
    }
    
    /**
     * Build a counterexample for models without explicit bad states.
     * Uses goal/terminal states (states with no successors or high-value states).
     * For two_dice example, this would be terminal states like (7,7).
     */
    private Counterexample buildGoalBasedCounterexample(TransitionSystem ts, PrismModelExtractor.ExtractionResult extraction) {
        Counterexample ce = new Counterexample();
        
        // Find terminal states (no outgoing transitions) as potential goals
        Set<String> terminalStates = new HashSet<>();
        for (String state : ts.getStates()) {
            Set<String> successors = ts.getSuccessors(state);
            if (successors == null || successors.isEmpty() || 
                (successors.size() == 1 && successors.contains(state))) {
                // Self-loop or no successors = terminal state
                terminalStates.add(state);
            }
        }
        
        logger.info("Found {} terminal/goal states for counterexample generation", terminalStates.size());
        
        if (!terminalStates.isEmpty() && ts.getInitial() != null) {
            // Pick the first reachable terminal state
            for (String goal : terminalStates) {
                List<String> path = findPathToGoal(ts, ts.getInitial(), goal);
                if (path != null && !path.isEmpty()) {
                    for (String state : path) {
                        ce.add(state);
                    }
                    logger.info("Generated goal-based counterexample with {} states (target: {})", 
                        path.size(), extraction.stateIdToName.get(goal));
                    
                    // Mark this goal as a "bad" state for the safety game
                    ts.addBadState(goal);
                    return ce;
                }
            }
        }
        
        // Fallback: if no terminal states, just use a path of length 5-10 from initial
        if (ts.getInitial() != null) {
            List<String> path = findAnyPath(ts, ts.getInitial(), 5);
            if (!path.isEmpty()) {
                for (String state : path) {
                    ce.add(state);
                }
                // Mark last state as "bad"
                ts.addBadState(path.get(path.size() - 1));
                logger.info("Generated fallback counterexample with {} states", path.size());
            }
        }
        
        return ce;
    }
    
    /**
     * Find a path from initial to a specific goal state using BFS.
     */
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
                // Reconstruct path
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
    
    /**
     * Find any path of approximate length from initial state.
     * Used as fallback when no terminal states exist.
     */
    private List<String> findAnyPath(TransitionSystem ts, String initial, int targetLength) {
        List<String> path = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        String current = initial;
        path.add(current);
        visited.add(current);
        
        while (path.size() < targetLength) {
            Set<String> successors = ts.getSuccessors(current);
            if (successors == null || successors.isEmpty()) break;
            
            // Pick first unvisited successor, or any successor if all visited
            String next = null;
            for (String succ : successors) {
                if (!visited.contains(succ)) {
                    next = succ;
                    break;
                }
            }
            
            if (next == null) {
                // All successors visited, pick any
                next = successors.iterator().next();
            }
            
            path.add(next);
            visited.add(next);
            current = next;
        }
        
        return path;
    }
    
    /**
     * Build a mock transition system that matches PMC-VIS graph structure.
     * Creates a simple chain/tree of states with transitions.
     */
    private TransitionSystem buildMockTransitionSystem(int level) {
        TransitionSystem ts = new TransitionSystem();
        
        // State IDs matching PMC-VIS Training project (two_dice model structure)
        String[] commonStateIds = {"0", "7", "14", "21", "28", "35", "42", "49", "56", "63",
                                   "70", "77", "84", "91", "98", "105", "112", "119", "126", "133",
                                   "140", "147", "154", "161", "168", "175", "182", "189", "196", "203",
                                   "392", "784", "1176", "1568", "1960", "2352", "2744", "3136", "3528", "3920"};
        
        // Use subset based on level
        int numStates = Math.min(5 + (level * 3), commonStateIds.length);
        
        // Add states
        for (int i = 0; i < numStates; i++) {
            ts.addState(commonStateIds[i]);
        }
        
        // Set initial state
        ts.setInitial(commonStateIds[0]);
        
        // Build transitions: create a chain with some branching
        for (int i = 0; i < numStates - 1; i++) {
            // Main path: state i -> state i+1
            ts.addTransition(commonStateIds[i], commonStateIds[i + 1]);
            
            // Add some branching (every 3rd state branches)
            if (i % 3 == 0 && i + 2 < numStates) {
                ts.addTransition(commonStateIds[i], commonStateIds[i + 2]);
            }
        }
        
        // Mark last few states as "bad" (error states)
        if (numStates > 2) {
            ts.addBadState(commonStateIds[numStates - 1]);
            if (numStates > 3) {
                ts.addBadState(commonStateIds[numStates - 2]);
            }
        }
        
        return ts;
    }
    
    /**
     * Build a mock counterexample trace ending in a bad state.
     */
    private Counterexample buildMockCounterexample(TransitionSystem ts) {
        Counterexample ce = new Counterexample();
        
        // Use override if provided
        if (overrideCounterexample != null && !overrideCounterexample.isEmpty()) {
            for (String state : overrideCounterexample) {
                ce.add(state);
            }
            return ce;
        }
        
        // Generate simple path from initial to a bad state
        if (ts.getInitial() != null && !ts.getBadStates().isEmpty()) {
            ce.add(ts.getInitial());
            
            // Simple path: follow first successor until we hit a bad state
            String current = ts.getInitial();
            Set<String> visited = new HashSet<>();
            visited.add(current);
            
            for (int step = 0; step < 10; step++) { // max 10 steps
                Set<String> successors = ts.getSuccessors(current);
                if (successors == null || successors.isEmpty()) break;
                
                // Pick first successor we haven't visited
                String next = null;
                for (String succ : successors) {
                    if (!visited.contains(succ)) {
                        next = succ;
                        break;
                    }
                }
                
                if (next == null) break; // dead end
                
                ce.add(next);
                visited.add(next);
                current = next;
                
                // Stop if we reached a bad state
                if (ts.getBadStates().contains(current)) {
                    break;
                }
            }
        }
        
        return ce;
    }
    
    /**
     * Generate component responsibilities based on model type.
     */
    private Map<String, Double> generateComponentResponsibility(String modelFile, Random random) {
        // Deterministic, model-derived placeholder until real tool aggregation is wired.
        // Strategy:
        //  1) Try to read the PRISM model at modelFile.
        //  2) Extract action labels [name] frequencies and module names.
        //  3) Rank actions by frequency (normalized to 0..1); give modules a mid value.
        //  4) If file not found, fall back to deterministic hash-based values.
        Map<String, Double> compResp = new HashMap<>();
        try {
            java.nio.file.Path p = java.nio.file.Paths.get(modelFile);
            logger.debug("Attempting to extract components from {}", p.toAbsolutePath());
            if (java.nio.file.Files.exists(p)) {
                String src = java.nio.file.Files.readString(p);
                logger.debug("Read {} characters from model file", src.length());
                
                // Extract action labels [name]
                java.util.regex.Pattern actPat = java.util.regex.Pattern.compile("\\[(\\w+)\\]");
                java.util.regex.Matcher m = actPat.matcher(src);
                Map<String, Integer> actCounts = new HashMap<>();
                while (m.find()) {
                    String a = m.group(1);
                    actCounts.put(a, actCounts.getOrDefault(a, 0) + 1);
                }
                logger.debug("Found {} unique actions in model", actCounts.size());
                
                // Extract module names
                java.util.regex.Pattern modPat = java.util.regex.Pattern.compile("(?m)^\\s*module\\s+(\\w+)");
                java.util.regex.Matcher mm = modPat.matcher(src);
                java.util.List<String> modules = new java.util.ArrayList<>();
                while (mm.find()) modules.add(mm.group(1));
                logger.debug("Found {} modules in model: {}", modules.size(), modules);
                
                // Normalize action counts
                int max = 0; 
                for (int c : actCounts.values()) max = Math.max(max, c);
                if (max > 0) {
                    for (Map.Entry<String, Integer> e : actCounts.entrySet()) {
                        double v = (double) e.getValue() / (double) max; // 0..1
                        compResp.put("action_" + e.getKey(), v);
                    }
                }
                
                // Add modules at 0.5 baseline (deterministic)
                for (String mod : modules) {
                    compResp.put("module_" + mod, 0.5);
                }
                
                logger.info("Extracted {} components from {}", compResp.size(), modelFile);
                
                // If still empty (no actions/modules), add a deterministic placeholder from file name
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
        
        // Fallback: deterministic by name hashing (no randomness)
        logger.info("Using fallback component generation for {}", modelFile);
        String[] defaults = new String[]{"module_system", "variable_state", "action_step", "action_init"};
        for (String name : defaults) {
            compResp.put(name, deterministicValue(name));
        }
        return compResp;
    }

    private double deterministicValue(String key) {
        int h = key != null ? key.hashCode() : 0;
        // Map hash to [0.35, 0.85]
        double u = (h & 0x7fffffff) / (double) Integer.MAX_VALUE; // [0,1)
        return 0.35 + 0.5 * u;
    }
    
    /**
     * Terminate any running tool process
     */
    public void terminate() {
        if (!isMockMode) {
            logger.info("Terminating responsibility tool process");
        }
    }
}
