package prism.responsibility;

import java.util.*;

/**
 * Safety game arena as defined in the paper (Section 2).
 * 
 * A safety game consists of:
 * - S_Safe: states controlled by player Safe
 * - S_Reach: states controlled by player Reach
 * - T: transition relation
 * - s0: initial state
 * - Bad: set of bad states (Safe wins if Bad is never reached)
 * 
 * This class implements the game construction from Definition 3.1:
 * G_ρ^TS(C) where coalition C controls certain states.
 */
public class SafetyGame {
    
    private final Set<String> safeStates;     // S_Safe: controlled by Safe
    private final Set<String> reachStates;    // S_Reach: controlled by Reach
    private final Map<String, Set<String>> transitions;
    private final String initial;
    private final Set<String> badStates;
    
    /**
     * Constructor for explicit game construction.
     */
    public SafetyGame(Set<String> safeStates, Set<String> reachStates,
                      Map<String, Set<String>> transitions,
                      String initial, Set<String> badStates) {
        this.safeStates = new HashSet<>(safeStates);
        this.reachStates = new HashSet<>(reachStates);
        this.transitions = new HashMap<>();
        for (Map.Entry<String, Set<String>> entry : transitions.entrySet()) {
            this.transitions.put(entry.getKey(), new HashSet<>(entry.getValue()));
        }
        this.initial = initial;
        this.badStates = new HashSet<>(badStates);
    }
    
    /**
     * Build game G_ρ^TS(C) from transition system and coalition C.
     * 
     * From Definition 3.1 in the paper:
     * - States in C are controlled by Safe
     * - States not in C are controlled by Reach
     * - For states on counterexample ρ not in C: only transition following ρ is kept
     * - For states not on ρ or states in C: all original transitions are kept
     * 
     * @param ts Transition system
     * @param rho Counterexample trace (ρ_0, ..., ρ_k)
     * @param coalition Coalition C ⊆ S
     * @return Safety game G_ρ^TS(C)
     */
    public static SafetyGame fromTransitionSystem(TransitionSystem ts, 
                                                  Counterexample rho,
                                                  Set<String> coalition) {
        Set<String> safeStates = new HashSet<>(coalition);
        Set<String> reachStates = new HashSet<>(ts.getStates());
        reachStates.removeAll(coalition);
        
        Map<String, Set<String>> gameTransitions = new HashMap<>();
        
        // Build transition relation following Definition 3.1
        List<String> trace = rho.getTrace();
        Set<String> traceSet = new HashSet<>(trace);
        
        for (String state : ts.getStates()) {
            Set<String> successors = ts.getSuccessors(state);
            if (successors == null || successors.isEmpty()) {
                gameTransitions.put(state, new HashSet<>());
                continue;
            }
            
            // Check if state is on counterexample and not in coalition
            if (traceSet.contains(state) && !coalition.contains(state)) {
                // For states on ρ not in C: only keep transition following ρ
                int idx = trace.indexOf(state);
                if (idx >= 0 && idx < trace.size() - 1) {
                    String nextOnTrace = trace.get(idx + 1);
                    Set<String> restricted = new HashSet<>();
                    restricted.add(nextOnTrace);
                    gameTransitions.put(state, restricted);
                } else {
                    // Last state on trace or not found: keep all transitions
                    gameTransitions.put(state, new HashSet<>(successors));
                }
            } else {
                // For states not on ρ or states in C: keep all transitions
                gameTransitions.put(state, new HashSet<>(successors));
            }
        }
        
        return new SafetyGame(safeStates, reachStates, gameTransitions,
                             ts.getInitial(), ts.getBadStates());
    }
    
    /**
     * Solve the safety game: compute winning region for Safe.
     * Uses the attractor algorithm (linear time, from Grädel et al. 2002).
     * 
     * Safe wins from states where she can force avoiding Bad states forever.
     * 
     * @return Set of states from which Safe has a winning strategy
     */
    public Set<String> computeSafeWinningRegion() {
        // Algorithm: Compute attractor to Bad for Reach, then complement
        // Attractor_Reach(Bad) = states from which Reach can force reaching Bad
        // Safe wins from all other states
        
        Set<String> allStates = new HashSet<>();
        allStates.addAll(safeStates);
        allStates.addAll(reachStates);
        
        Set<String> reachAttractor = computeReachAttractor(badStates);
        
        Set<String> safeWinning = new HashSet<>(allStates);
        safeWinning.removeAll(reachAttractor);
        
        return safeWinning;
    }
    
    /**
     * Compute attractor for Reach player to target set.
     * States from which Reach can force reaching target.
     * 
     * Fixed-point iteration:
     * - Start with target
     * - Add predecessors where Reach can force entry
     * - Continue until no new states are added
     * 
     * @param target Target set
     * @return Attractor set
     */
    private Set<String> computeReachAttractor(Set<String> target) {
        Set<String> attractor = new HashSet<>(target);
        Queue<String> queue = new LinkedList<>(target);
        
        while (!queue.isEmpty()) {
            String current = queue.poll();
            
            // Find predecessors of current
            for (String state : transitions.keySet()) {
                if (attractor.contains(state)) continue;
                
                Set<String> successors = transitions.get(state);
                if (successors == null || !successors.contains(current)) {
                    continue;
                }
                
                // Check if state should be added to attractor
                boolean shouldAdd = false;
                
                if (reachStates.contains(state)) {
                    // Reach-controlled state: add if ANY successor is in attractor
                    for (String succ : successors) {
                        if (attractor.contains(succ)) {
                            shouldAdd = true;
                            break;
                        }
                    }
                } else {
                    // Safe-controlled state: add if ALL successors are in attractor
                    shouldAdd = true;
                    for (String succ : successors) {
                        if (!attractor.contains(succ)) {
                            shouldAdd = false;
                            break;
                        }
                    }
                }
                
                if (shouldAdd) {
                    attractor.add(state);
                    queue.add(state);
                }
            }
        }
        
        return attractor;
    }
    
    /**
     * Check if Safe wins this game (from initial state).
     */
    public boolean doesSafeWin() {
        Set<String> safeWinning = computeSafeWinningRegion();
        return safeWinning.contains(initial);
    }
    
    // Getters
    public Set<String> getSafeStates() { return new HashSet<>(safeStates); }
    public Set<String> getReachStates() { return new HashSet<>(reachStates); }
    public Map<String, Set<String>> getTransitions() { return new HashMap<>(transitions); }
    public String getInitial() { return initial; }
    public Set<String> getBadStates() { return new HashSet<>(badStates); }
}
