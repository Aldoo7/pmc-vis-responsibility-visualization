package prism.responsibility;

import java.util.*;
import prism.responsibility.ResponsibilityEnums.PowerIndex;

/**
 *  Pessimistic responsibility strategy implementing the algorithm from:
 * "Backward Responsibility in Transition Systems Using General Power Indices"
 * (Baier et al., 2024) - https://arxiv.org/abs/2402.01539
 * 
 * KEY FORMULAS (extracted from paper):
 * 
 * Definition 3.1: Pessimistic cooperative game
 * v_pes(C) = 1 if Safe wins G_ρ^TS(C), 0 otherwise
 * 
 * General power index formula:
 * R(v, i) = Σ_{C ⊆ N \ {i}} p_{|C|} · [v(C ∪ {i}) - v(C)]
 * 
 * Shapley value weights:
 * p_i = (n - i - 1)! · i! / n!
 * 
 * Banzhaf index weights:
 * p_i = 1 / 2^(n-1)
 * 
 */
public class PessimisticExactStrategyCorrected implements ResponsibilityStrategy {

    @Override
    public ResponsibilityOutput compute(TransitionSystem ts, Counterexample counterexample, int level, PowerIndex powerIndex) {
        List<String> trace = counterexample.getTrace();
        
        // Players are states on the counterexample (excluding error state if present)
        List<String> players = new ArrayList<>();
        for (String state : trace) {
            if (!ts.getBadStates().contains(state)) {
                players.add(state);
            }
        }
        
        int n = players.size();
        Map<String, Double> stateResponsibility = new HashMap<>();
        
        if (n == 0) {
            // No players - return empty result
            ResponsibilityOutput output = new ResponsibilityOutput(level, stateResponsibility);
            output.setResponsibilityType("pessimistic");
            output.setPowerIndex(powerIndex.name().toLowerCase());
            return output;
        }
        
        // Compute responsibility using general power index formula
        for (int playerIdx = 0; playerIdx < n; playerIdx++) {
            String player = players.get(playerIdx);
            double responsibility = 0.0;
            
            // Enumerate all coalitions C ⊆ N \ {player}
            int numCoalitions = 1 << (n - 1); // 2^(n-1)
            
            for (int mask = 0; mask < numCoalitions; mask++) {
                // Build coalition C from mask (excluding player)
                Set<String> coalition = new HashSet<>();
                int bitPos = 0;
                for (int i = 0; i < n; i++) {
                    if (i != playerIdx) {
                        if ((mask & (1 << bitPos)) != 0) {
                            coalition.add(players.get(i));
                        }
                        bitPos++;
                    }
                }
                
                // Build coalition C ∪ {player}
                Set<String> coalitionWithPlayer = new HashSet<>(coalition);
                coalitionWithPlayer.add(player);
                
                // Compute v_pes(C) and v_pes(C ∪ {player})
                int valueWithout = pessimisticCoalitionValue(ts, counterexample, coalition);
                int valueWith = pessimisticCoalitionValue(ts, counterexample, coalitionWithPlayer);
                
                // Marginal contribution
                int marginalValue = valueWith - valueWithout;
                
                if (marginalValue > 0) {
                    // Apply weight based on power index
                    double weight;
                    if (powerIndex == PowerIndex.SHAPLEY) {
                        // Shapley: p_|C| = (n - |C| - 1)! · |C|! / n!
                        weight = shapleyWeight(coalition.size(), n);
                    } else {
                        // Banzhaf: p_|C| = 1 / 2^(n-1)
                        weight = 1.0 / Math.pow(2, n - 1);
                    }
                    
                    responsibility += weight;
                }
            }
            
            stateResponsibility.put(player, responsibility);
        }
        
        // Aggregate to component-level responsibility
        Map<String, Double> componentResponsibility = aggregateToComponents(ts, stateResponsibility);
        
        // Build output object
        ResponsibilityOutput output = new ResponsibilityOutput(level, stateResponsibility);
        output.setComponentResponsibility(componentResponsibility);
        output.setResponsibilityType("pessimistic");
        output.setPowerIndex(powerIndex.name().toLowerCase());
        output.setCounterexample(counterexample.getTrace());
        output.setApproximate(false);
        
        // Prepare state metadata
        Map<String, ResponsibilityOutput.StateInfo> stateMetadata = new HashMap<>();
        for (String state : players) {
            ResponsibilityOutput.StateInfo info = new ResponsibilityOutput.StateInfo();
            info.setOnTrace(trace.contains(state));
            info.setBranchingDegree(ts.branchingDegree(state));
            // For pessimistic: check if state alone can win
            Set<String> singletonCoalition = new HashSet<>();
            singletonCoalition.add(state);
            info.setCanWinAlone(pessimisticCoalitionValue(ts, counterexample, singletonCoalition) == 1);
            stateMetadata.put(state, info);
        }
        output.setStateMetadata(stateMetadata);
        
        return output;
    }
    
    /**
     * Compute v_pes(C) = 1 if Safe wins G_ρ^TS(C), 0 otherwise
     * 
     * Definition 3.1: In pessimistic game, coalition C controls Safe states,
     * rest controls Reach states. States on trace ρ not in C have restricted
     * transitions (must follow trace).
     */
    private int pessimisticCoalitionValue(
            TransitionSystem ts, 
            Counterexample counterexample,
            Set<String> coalition) {
        
        SafetyGame game = SafetyGame.fromTransitionSystem(ts, counterexample, coalition);
        return game.doesSafeWin() ? 1 : 0;
    }
    
    /**
     * Shapley weight formula: p_i = (n - i - 1)! · i! / n!
     * 
     * Simplified computation using combinations:
     * p_i = 1 / (n * C(n-1, i))
     * where C(n-1, i) = (n-1)! / (i! * (n-1-i)!)
     */
    private double shapleyWeight(int coalitionSize, int numPlayers) {
        if (numPlayers == 0) return 0.0;
        
        // Compute (n - |C| - 1)! · |C|! / n!
        // = 1 / (n * C(n-1, |C|))
        int i = coalitionSize;
        int n = numPlayers;
        
        // Calculate binomial coefficient C(n-1, i)
        long binomial = binomialCoefficient(n - 1, i);
        
        return 1.0 / (n * binomial);
    }
    
    /**
     * Compute binomial coefficient C(n, k) = n! / (k! * (n-k)!)
     * Uses iterative method to avoid overflow
     */
    private long binomialCoefficient(int n, int k) {
        if (k > n) return 0;
        if (k == 0 || k == n) return 1;
        if (k > n - k) k = n - k; // C(n, k) = C(n, n-k)
        
        long result = 1;
        for (int i = 0; i < k; i++) {
            result = result * (n - i) / (i + 1);
        }
        return result;
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
