package prism.responsibility;

import java.util.*;

/**
 * Safety game arena (Definition 3.1).
 * Players Safe and Reach control disjoint state sets;
 * Safe wins by avoiding Bad states indefinitely.
 */
public class SafetyGame {
    
    private final Set<String> safeStates;     // S_Safe: controlled by Safe
    private final Set<String> reachStates;    // S_Reach: controlled by Reach
    private final Map<String, Set<String>> transitions;
    private final String initial;
    private final Set<String> badStates;
    
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
     * Build game G_ρ^TS(C) from a transition system and coalition C.
     * States in C are controlled by Safe; states not in C by Reach.
     * For Reach states on ρ, only the trace-following transition is kept.
     */
    public static SafetyGame fromTransitionSystem(TransitionSystem ts, 
                                                  Counterexample rho,
                                                  Set<String> coalition) {
        Set<String> safeStates = new HashSet<>(coalition);
        Set<String> reachStates = new HashSet<>(ts.getStates());
        reachStates.removeAll(coalition);
        
        Map<String, Set<String>> gameTransitions = new HashMap<>();
        List<String> trace = rho.getTrace();
        Set<String> traceSet = new HashSet<>(trace);
        
        for (String state : ts.getStates()) {
            Set<String> successors = ts.getSuccessors(state);
            if (successors == null || successors.isEmpty()) {
                gameTransitions.put(state, new HashSet<>());
                continue;
            }
            
            if (traceSet.contains(state) && !coalition.contains(state)) {
                int idx = trace.indexOf(state);
                if (idx >= 0 && idx < trace.size() - 1) {
                    String nextOnTrace = trace.get(idx + 1);
                    Set<String> restricted = new HashSet<>();
                    restricted.add(nextOnTrace);
                    gameTransitions.put(state, restricted);
                } else {
                    gameTransitions.put(state, new HashSet<>(successors));
                }
            } else {
                gameTransitions.put(state, new HashSet<>(successors));
            }
        }
        
        return new SafetyGame(safeStates, reachStates, gameTransitions,
                             ts.getInitial(), ts.getBadStates());
    }
    
    /**
     * Compute Safe's winning region via Reach-attractor complement.
     */
    public Set<String> computeSafeWinningRegion() {
        
        Set<String> allStates = new HashSet<>();
        allStates.addAll(safeStates);
        allStates.addAll(reachStates);
        
        Set<String> reachAttractor = computeReachAttractor(badStates);
        
        Set<String> safeWinning = new HashSet<>(allStates);
        safeWinning.removeAll(reachAttractor);
        
        return safeWinning;
    }

    /**
     * Result of solving the safety game.
     */
    public static class GameResult {
        public final Set<String> winningRegion;
        public final Map<String, String> strategy;
        public final boolean safeWinsFromInitial;

        public GameResult(Set<String> winningRegion, Map<String, String> strategy, boolean safeWinsFromInitial) {
            this.winningRegion = winningRegion;
            this.strategy = strategy;
            this.safeWinsFromInitial = safeWinsFromInitial;
        }
    }

    /**
     * Solve the game: compute winning region and extract Safe's strategy.
     */
    public GameResult solve() {
        Set<String> winningRegion = computeSafeWinningRegion();

        Map<String, String> strategy = new HashMap<>();
        for (String state : winningRegion) {
            if (!safeStates.contains(state)) continue;
            Set<String> successors = transitions.get(state);
            if (successors == null || successors.isEmpty()) continue;
            for (String succ : successors) {
                if (winningRegion.contains(succ)) {
                    strategy.put(state, succ);
                    break;
                }
            }
        }

        boolean safeWins = winningRegion.contains(initial);
        return new GameResult(winningRegion, strategy, safeWins);
    }
    
    /**
     * Compute Reach-attractor to target set (fixed-point iteration).
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
                
                boolean shouldAdd = false;
                
                if (reachStates.contains(state)) {
                    for (String succ : successors) {
                        if (attractor.contains(succ)) {
                            shouldAdd = true;
                            break;
                        }
                    }
                } else {
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
    
    public boolean doesSafeWin() {
        Set<String> safeWinning = computeSafeWinningRegion();
        return safeWinning.contains(initial);
    }
    
    public Set<String> getSafeStates() { return new HashSet<>(safeStates); }
    public Set<String> getReachStates() { return new HashSet<>(reachStates); }
    public Map<String, Set<String>> getTransitions() { return new HashMap<>(transitions); }
    public String getInitial() { return initial; }
    public Set<String> getBadStates() { return new HashSet<>(badStates); }
}
