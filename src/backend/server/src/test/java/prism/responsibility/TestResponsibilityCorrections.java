package prism.responsibility;

import prism.responsibility.ResponsibilityEnums.PowerIndex;
import java.util.*;

/**
 * Test the corrected responsibility strategies against the paper's railway example.
 * 
 * From "Backward Responsibility in Transition Systems" (Baier et al., 2024):
 * 
 * Railway network example (Figure 1):
 * - States: s1 (init), s2, s3, error
 * - Counterexample: ρ = s1 · s2 · error
 * - Expected Shapley values (Table 1): 
 *   S(v_pes, s1) = 1/6
 *   S(v_pes, s2) = 2/3
 *   S(v_pes, s3) = 1/6
 * 
 * Expected optimistic:
 * - WS_opt = {s1, s2, s3} (all states can contribute)
 * - S(v_opt, s_i) = 1/3 for all i ∈ {1,2,3} (Proposition 4.1)
 */
public class TestResponsibilityCorrections {
    
    public static void main(String[] args) {
        System.out.println("Testing corrected responsibility formulas...\n");
        
        // Build simple transition system matching paper example
        TransitionSystem ts = buildRailwayExample();
        
        // Counterexample: s1 -> s2 -> s3 -> error
        Counterexample rho = new Counterexample(Arrays.asList("s1", "s2", "s3", "error"));
        
        // Test optimistic strategy
        testOptimistic(ts, rho);
        
        // Test pessimistic strategy
        testPessimistic(ts, rho);
    }
    
    private static void testOptimistic(TransitionSystem ts, Counterexample rho) {
        System.out.println("=== OPTIMISTIC RESPONSIBILITY (Shapley) ===");
        
        OptimisticExactStrategyCorrected strategy = new OptimisticExactStrategyCorrected();
        ResponsibilityOutput result = strategy.compute(ts, rho, 0, PowerIndex.SHAPLEY);
        
        System.out.println("State responsibilities:");
        Map<String, Double> stateResp = result.getStateResponsibility();
        for (String state : Arrays.asList("s1", "s2", "s3")) {
            Double resp = stateResp.getOrDefault(state, 0.0);
            System.out.printf("  %s: %.4f\n", state, resp);
        }
        
        System.out.println("\nOptimistic winning set: " + result.getWinningStates());
        System.out.println("Normalization constant K: " + result.getNormalizationConstantK());
        System.out.println("Expected: States with alternatives (s1, s2) should be in winning set");
        System.out.println();
    }
    
    private static void testPessimistic(TransitionSystem ts, Counterexample rho) {
        System.out.println("=== PESSIMISTIC RESPONSIBILITY (Shapley) ===");
        
        PessimisticExactStrategyCorrected strategy = new PessimisticExactStrategyCorrected();
        ResponsibilityOutput result = strategy.compute(ts, rho, 0, PowerIndex.SHAPLEY);
        
        System.out.println("State responsibilities:");
        Map<String, Double> stateResp = result.getStateResponsibility();
        for (String state : Arrays.asList("s1", "s2", "s3")) {
            Double resp = stateResp.getOrDefault(state, 0.0);
            System.out.printf("  %s: %.4f\n", state, resp);
        }
        System.out.println("\nExpected: Earlier choice points (s1, s2) should have higher responsibility than s3");
        System.out.println();
    }
    
    /**
     * Build railway transition system matching the paper's example more closely.
     * 
     * From the paper (Figure 1 - Railway Network):
     * The key is that the system has choice points where states can influence outcome.
     * 
     * Improved model:
     * s1 (init) -> s2 (choice point)
     *           -> s4 (safe path)
     * s2 -> s3 (leads to error)
     *    -> s5 (safe path)
     * s3 -> error
     * s4 -> safe
     * s5 -> safe
     * 
     * Counterexample: s1 -> s2 -> s3 -> error
     * Players: {s1, s2, s3}
     * 
     * Key insight: 
     * - s1 can avoid error by choosing s4 instead of s2 (can win alone)
     * - s2 can avoid error by choosing s5 instead of s3 (can win alone)
     * - s3 cannot win alone (only goes to error)
     * 
     * So WS_opt should be {s1, s2} (not s3)
     */
    private static TransitionSystem buildRailwayExample() {
        TransitionSystem ts = new TransitionSystem();
        
        // Add states
        ts.addState("s1");
        ts.addState("s2");
        ts.addState("s3");
        ts.addState("s4");
        ts.addState("s5");
        ts.addState("error");
        ts.addState("safe");
        
        // Set initial state
        ts.setInitial("s1");
        
        // Add transitions
        ts.addTransition("s1", "s2");  // On trace
        ts.addTransition("s1", "s4");  // Alternative (safe)
        ts.addTransition("s2", "s3");  // On trace
        ts.addTransition("s2", "s5");  // Alternative (safe)
        ts.addTransition("s3", "error"); // On trace -> error
        ts.addTransition("s4", "safe");
        ts.addTransition("s5", "safe");
        
        // Mark bad state
        ts.addBadState("error");
        
        return ts;
    }
}
