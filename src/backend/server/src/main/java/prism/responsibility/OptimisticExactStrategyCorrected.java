package prism.responsibility;

import java.util.*;
import prism.responsibility.ResponsibilityEnums.PowerIndex;

/**
 * CORRECTED Optimistic responsibility strategy implementing the algorithm from:
 * "Backward Responsibility in Transition Systems Using General Power Indices"
 * (Baier et al., 2024) - https://arxiv.org/abs/2402.01539
 * 
 * KEY FORMULAS (extracted from paper):
 * 
 * Definition 3.1: Optimistic cooperative game
 * v_opt(C) = 1 if Safe wins G_ρ^TS(C ∪ (S \ ρ)), 0 otherwise
 * 
 * Theorem 4: Characterization of optimistic responsibility
 * R(v_opt, s) = K if s ∈ WS_opt, 0 otherwise
 * where WS_opt = {s ∈ S | v_opt({s}) = 1}
 * 
 * Proposition 4.1: For Shapley and Banzhaf values
 * Shapley:  S(v_opt, s) = 1/|WS_opt| for s ∈ WS_opt
 * Banzhaf:  B(v_opt, s) = 1/2^(|WS_opt| - 1) for s ∈ WS_opt
 * 
 * CORRECTIONS from original implementation:
 * 1. Players are states on counterexample ρ, not successors
 * 2. Coalition value uses SafetyGame solver, not set membership
 * 3. Uses characterization theorem (uniform K for all WS_opt states)
 * 4. No extra /n normalization
 */
public class OptimisticExactStrategyCorrected implements ResponsibilityStrategy {

    @Override
    public ResponsibilityOutput compute(TransitionSystem ts, Counterexample counterexample, int level, PowerIndex powerIndex) {
        List<String> trace = counterexample.getTrace();
        
        // Players are states on the counterexample (excluding error state if present)
        Set<String> players = new HashSet<>();
        for (String state : trace) {
            if (!ts.getBadStates().contains(state)) {
                players.add(state);
            }
        }
        
        // Step 1: Compute optimistic winning set WS_opt = {s | v_opt({s}) = 1}
        Set<String> wsOpt = computeOptimisticWinningSet(ts, counterexample, players);
        
        // Step 2: Apply Theorem 4 characterization
        Map<String, Double> stateResponsibility = new HashMap<>();
        
        if (wsOpt.isEmpty()) {
            // No states can win optimistically - all get 0 responsibility
            for (String player : players) {
                stateResponsibility.put(player, 0.0);
            }
        } else {
            // Compute K value based on power index (Proposition 4.1)
            double K;
            if (powerIndex == PowerIndex.SHAPLEY) {
                // Shapley: K = 1/|WS_opt|
                K = 1.0 / wsOpt.size();
            } else {
                // Banzhaf: K = 1/2^(|WS_opt| - 1)
                K = 1.0 / Math.pow(2, wsOpt.size() - 1);
            }
            
            // Assign K to winning states, 0 to others
            for (String player : players) {
                stateResponsibility.put(player, wsOpt.contains(player) ? K : 0.0);
            }
        }
        
        // Aggregate to component-level responsibility
        Map<String, Double> componentResponsibility = aggregateToComponents(ts, stateResponsibility);
        
        // Build output object
        ResponsibilityOutput output = new ResponsibilityOutput(level, stateResponsibility);
        output.setComponentResponsibility(componentResponsibility);
        output.setResponsibilityType("optimistic");
        output.setPowerIndex(powerIndex.name().toLowerCase());
        output.setCounterexample(counterexample.getTrace());
        output.setWinningStates(new ArrayList<>(wsOpt));
        output.setApproximate(false);
        output.setNormalizationConstantK(wsOpt.isEmpty() ? 0.0 : 
            (powerIndex == PowerIndex.SHAPLEY ? 1.0 / wsOpt.size() : 1.0 / Math.pow(2, wsOpt.size() - 1)));
        
        // Prepare state metadata
        Map<String, ResponsibilityOutput.StateInfo> stateMetadata = new HashMap<>();
        for (String state : players) {
            ResponsibilityOutput.StateInfo info = new ResponsibilityOutput.StateInfo();
            info.setOnTrace(trace.contains(state));
            info.setBranchingDegree(ts.branchingDegree(state));
            info.setCanWinAlone(wsOpt.contains(state));
            stateMetadata.put(state, info);
        }
        output.setStateMetadata(stateMetadata);
        
        return output;
    }
    
    /**
     * Compute WS_opt = {s ∈ S | v_opt({s}) = 1}
     * 
     * For each state s on the counterexample:
     * - Build game G_ρ^TS({s} ∪ (S \ ρ))
     * - Check if Safe wins
     * - If yes, s ∈ WS_opt
     * 
     * Definition 3.1: Coalition C controls Safe states, rest controls Reach states
     * States on trace ρ not in C get restricted transitions (follow trace)
     */
    private Set<String> computeOptimisticWinningSet(
            TransitionSystem ts, 
            Counterexample counterexample,
            Set<String> players) {
        
        Set<String> wsOpt = new HashSet<>();
        List<String> trace = counterexample.getTrace();
        Set<String> statesOnTrace = new HashSet<>(trace);
        
        for (String state : players) {
            // Coalition for optimistic game: {state} ∪ (all states not on trace)
            Set<String> coalition = new HashSet<>();
            coalition.add(state);
            
            // Add all states not on the trace
            for (String s : ts.getStates()) {
                if (!statesOnTrace.contains(s)) {
                    coalition.add(s);
                }
            }
            
            // Build and solve safety game
            SafetyGame game = SafetyGame.fromTransitionSystem(ts, counterexample, coalition);
            
            if (game.doesSafeWin()) {
                wsOpt.add(state);
            }
        }
        
        return wsOpt;
    }
    
    /**
     * Aggregate state-level responsibility to component-level.
     * 
     * Components can be:
     * - Modules (if model has module structure)
     * - Variables (aggregate states by variable values)
     * - Actions (aggregate by enabled actions)
     * 
     * For now, implements a simple heuristic based on state naming.
     */
    private Map<String, Double> aggregateToComponents(
            TransitionSystem ts, 
            Map<String, Double> stateResponsibility) {
        
        Map<String, Double> componentResp = new HashMap<>();
        Map<String, Integer> componentCounts = new HashMap<>();
        
        // Parse state names to extract components
        // Format: "s1", "s2", etc. or "module.var=val"
        for (Map.Entry<String, Double> entry : stateResponsibility.entrySet()) {
            String state = entry.getKey();
            double resp = entry.getValue();
            
            // Extract component name (simplified heuristic)
            String component;
            if (state.contains(".")) {
                // Module-based: "module.var=val" -> "module"
                component = state.substring(0, state.indexOf('.'));
            } else if (state.matches("s\\d+")) {
                // Simple state naming: "s1" -> "state"
                component = "state";
            } else {
                component = "unknown";
            }
            
            // Aggregate (average across states in component)
            componentResp.put(component, componentResp.getOrDefault(component, 0.0) + resp);
            componentCounts.put(component, componentCounts.getOrDefault(component, 0) + 1);
        }
        
        // Average by count
        for (String component : componentResp.keySet()) {
            int count = componentCounts.get(component);
            if (count > 0) {
                componentResp.put(component, componentResp.get(component) / count);
            }
        }
        
        return componentResp;
    }
}
