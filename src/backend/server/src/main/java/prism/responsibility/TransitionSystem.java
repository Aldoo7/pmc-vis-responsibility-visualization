package prism.responsibility;

import java.util.*;

/**
 * Lightweight representation of a transition system TS = (S, ->, s0, Bad).
 * For future replacement with PRISM-derived structure.
 */
public class TransitionSystem {
    private final Set<String> states = new HashSet<>();
    private final Map<String, Set<String>> successors = new HashMap<>();
    private String initial;
    private final Set<String> badStates = new HashSet<>();

    public Set<String> getStates() {
        return states;
    }

    public Set<String> getSuccessors(String state) {
        return successors.get(state);
    }

    public String getInitial() {
        return initial;
    }

    public void setInitial(String initial) {
        this.initial = initial;
    }

    public Set<String> getBadStates() {
        return badStates;
    }

    public void addState(String state) {
        states.add(state);
    }

    public void addTransition(String from, String to) {
        successors.computeIfAbsent(from, k -> new HashSet<>()).add(to);
    }

    public void addBadState(String state) {
        badStates.add(state);
    }

    public int branchingDegree(String s) {
        Set<String> succs = successors.get(s);
        return succs != null ? succs.size() : 0;
    }

    /**
     * Total number of directed edges (transitions) in the graph.
     */
    public int getTransitionCount() {
        int count = 0;
        for (Set<String> succs : successors.values()) {
            if (succs != null) count += succs.size();
        }
        return count;
    }

    /**
     * Convenience for mock/testing: create n placeholder states s_0..s_{n-1}
     */
    public void setStateCount(int n) {
        states.clear();
        successors.clear();
        for (int i = 0; i < n; i++) {
            String id = "s_" + i;
            states.add(id);
            successors.put(id, new HashSet<>());
        }
        initial = n > 0 ? "s_0" : null;
    }
}
